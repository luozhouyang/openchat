import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { channelDoName } from "protocol";
import { requireSession } from "../../auth/session.ts";
import { requireTeamRole, requireChannelRole } from "../../auth/guards.ts";
import { getDb } from "../../db/client.ts";
import { channelMembers } from "../../db/schema-d1.ts";
import { listChannelsForTeam, getChannel, listChannelMemberIds } from "../../db/repos/channels.ts";
import { getTeamMember } from "../../db/repos/teams.ts";
import {
  createChannel,
  openDirect,
  openGroup,
  joinChannel,
  leaveChannel,
  archiveChannel,
  restoreChannel,
} from "../../services/channel.service.ts";
import { HttpError } from "../../lib/errors.ts";
import { parsePage } from "../../lib/pagination.ts";
import {
  syncChannelMember,
  syncUserChannels,
  removeChannelMemberFromDo,
} from "../../user-do-sync.ts";

const slug = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

const CreateChannelBody = z.object({
  team_id: z.string().min(1),
  name: slug.optional(),
  display_name: z.string().min(1).max(128),
  type: z.enum(["public", "private"]),
  purpose: z.string().max(500).optional(),
  header: z.string().max(1024).optional(),
});

const NotifyPropsBody = z.object({
  notify_props: z.object({
    pref: z.enum(["all", "mention", "none"]).default("all"),
  }),
});

export const channelsV1 = new Hono<{ Bindings: Env }>();

channelsV1.post("/channels", requireSession, async (c) => {
  const body = CreateChannelBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const db = getDb(c.env.DB);
  const me = c.get("session")!.user.id;
  const teamId = body.data.team_id;
  const teamMember = await getTeamMember(db, teamId, me);
  if (!teamMember) return c.json({ error: "forbidden" }, 403);
  try {
    const ch = await createChannel(db, {
      teamId,
      name: body.data.name,
      displayName: body.data.display_name,
      type: body.data.type,
      purpose: body.data.purpose,
      header: body.data.header,
      creatorId: me,
    });
    await syncChannelMember(c.env, ch.id, ch.creatorId!, "channel_admin");
    return c.json({ id: ch.id }, 201);
  } catch (err) {
    if (err instanceof HttpError)
      return c.json({ error: err.code }, err.status as ContentfulStatusCode);
    throw err;
  }
});

channelsV1.get("/teams/:teamId/channels", requireSession, requireTeamRole("member"), async (c) => {
  const db = getDb(c.env.DB);
  const teamId = c.req.param("teamId");
  const userId = c.get("session")!.user.id;
  const all = await listChannelsForTeam(db, teamId);
  const mine = new Set(
    (await db.select().from(channelMembers).where(eq(channelMembers.userId, userId))).map(
      (r) => r.channelId,
    ),
  );
  return c.json({
    channels: all.map((ch) => ({
      id: ch.id,
      teamId: ch.teamId,
      name: ch.name,
      displayName: ch.displayName,
      type: ch.type,
      member: mine.has(ch.id),
      archivedAt: ch.archivedAt,
    })),
  });
});

channelsV1.get("/channels/:channelId", requireSession, requireChannelRole("member"), async (c) => {
  const db = getDb(c.env.DB);
  const ch = (await getChannel(db, c.req.param("channelId")))!;
  const memberIds = await listChannelMemberIds(db, ch.id);
  return c.json({
    id: ch.id,
    displayName: ch.displayName,
    type: ch.type,
    purpose: ch.purpose,
    header: ch.header,
    memberCount: memberIds.length,
    archivedAt: ch.archivedAt,
  });
});

channelsV1.post("/channels/:channelId/members", requireSession, async (c) => {
  const db = getDb(c.env.DB);
  const channelId = c.req.param("channelId");
  const userId = c.get("session")!.user.id;
  try {
    const joined = await joinChannel(db, { channelId, userId });
    if (joined) {
      await syncChannelMember(c.env, channelId, userId, "channel_user");
      await syncUserChannels(c.env, userId);
    }
  } catch (err) {
    if (err instanceof HttpError)
      return c.json({ error: err.code }, err.status as ContentfulStatusCode);
    throw err;
  }
  return c.json({ ok: true });
});

channelsV1.delete(
  "/channels/:channelId/members/:userId",
  requireSession,
  requireChannelRole("member"),
  async (c) => {
    const userId = c.req.param("userId");
    const me = c.get("session")!.user.id;
    if (userId !== me) return c.json({ error: "forbidden" }, 403);
    const db = getDb(c.env.DB);
    const channelId = c.req.param("channelId");
    await leaveChannel(db, { channelId, userId });
    await removeChannelMemberFromDo(c.env, channelId, userId);
    await syncUserChannels(c.env, userId);
    return c.json({ ok: true });
  },
);

channelsV1.post("/channels/direct", requireSession, async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  if (
    !Array.isArray(raw) ||
    raw.length !== 2 ||
    raw.some((u) => typeof u !== "string" || u.length === 0)
  ) {
    return c.json({ error: "invalid" }, 422);
  }
  const me = c.get("session")!.user.id;
  const [x, y] = raw as [string, string];
  if (x === me && y === me) return c.json({ error: "invalid" }, 422);
  const withUserId = x === me ? y : y === me ? x : null;
  if (!withUserId) return c.json({ error: "invalid" }, 422);
  const db = getDb(c.env.DB);
  try {
    const { id: channelId, existing } = await openDirect(db, { userId: me, withUserId });
    if (!existing) {
      await syncChannelMember(c.env, channelId, me, "channel_user");
      await syncChannelMember(c.env, channelId, withUserId, "channel_user");
      await syncUserChannels(c.env, me);
      await syncUserChannels(c.env, withUserId);
    }
    return c.json({ id: channelId, existing }, existing ? 200 : 201);
  } catch (err) {
    if (err instanceof HttpError)
      return c.json({ error: err.code }, err.status as ContentfulStatusCode);
    throw err;
  }
});

channelsV1.post("/channels/group", requireSession, async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  if (!Array.isArray(raw) || raw.some((u) => typeof u !== "string" || u.length === 0)) {
    return c.json({ error: "invalid" }, 422);
  }
  const me = c.get("session")!.user.id;
  const userIds = (raw as string[]).filter((u) => u !== me);
  if (userIds.length < 2) return c.json({ error: "invalid" }, 422);
  const db = getDb(c.env.DB);
  try {
    const { id: channelId, existing } = await openGroup(db, { userId: me, userIds });
    if (!existing) {
      const ids = [...new Set([me, ...userIds])];
      for (const uid of ids) {
        await syncChannelMember(c.env, channelId, uid, "channel_user");
        await syncUserChannels(c.env, uid);
      }
    }
    return c.json({ id: channelId, existing }, existing ? 200 : 201);
  } catch (err) {
    if (err instanceof HttpError)
      return c.json({ error: err.code }, err.status as ContentfulStatusCode);
    throw err;
  }
});

channelsV1.delete(
  "/channels/:channelId",
  requireSession,
  requireChannelRole("admin"),
  async (c) => {
    const db = getDb(c.env.DB);
    await archiveChannel(db, { channelId: c.req.param("channelId") });
    return c.json({ ok: true });
  },
);

channelsV1.post(
  "/channels/:channelId/restore",
  requireSession,
  requireChannelRole("admin"),
  async (c) => {
    const db = getDb(c.env.DB);
    await restoreChannel(db, { channelId: c.req.param("channelId") });
    return c.json({ ok: true });
  },
);

channelsV1.get(
  "/channels/:channelId/members",
  requireSession,
  requireChannelRole("member"),
  async (c) => {
    const db = getDb(c.env.DB);
    const { page, perPage } = parsePage(new URL(c.req.url).searchParams);
    const all = await listChannelMemberIds(db, c.req.param("channelId"));
    const start = page * perPage;
    return c.json({ member_ids: all.slice(start, start + perPage) });
  },
);

channelsV1.put(
  "/channels/:channelId/members/:userId/notify_props",
  requireSession,
  requireChannelRole("member"),
  async (c) => {
    const body = NotifyPropsBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid" }, 422);
    const userId = c.req.param("userId");
    const me = c.get("session")!.user.id;
    if (userId !== me) return c.json({ error: "forbidden" }, 403);
    const id = c.env.CHANNEL_DO.idFromName(channelDoName(c.req.param("channelId")));
    const res = await c.env.CHANNEL_DO.get(id).setNotifPref({
      userId: me,
      pref: body.data.notify_props.pref,
    });
    if ("error" in res) return c.json({ error: res.error }, res.status);
    return c.json({ ok: true });
  },
);
