import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { channelDoName, type ChannelType } from "protocol";
import {
  CreateChannelInput,
  CreateChannelOutput,
  OpenDirectInput,
  OpenGroupInput,
  OpenChannelOutput,
  ChannelsForTeamOutput,
  ChannelDetailOutput,
  ListMembersQuery,
  ChannelsListOutput,
  NotifyPropsInput,
} from "protocol";
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
import { zodValidator } from "../../lib/validation.ts";
import { apiError } from "../../lib/errors.ts";
import {
  syncChannelMember,
  syncUserChannels,
  removeChannelMemberFromDo,
} from "../../user-do-sync.ts";

export const channelsV1 = new Hono<{ Bindings: Env }>();

channelsV1.post(
  "/channels",
  requireSession,
  zodValidator("json", CreateChannelInput),
  async (c) => {
    const body = c.req.valid("json");
    const db = getDb(c.env.DB);
    const me = c.get("session")!.user.id;
    const teamMember = await getTeamMember(db, body.teamId, me);
    if (!teamMember) throw apiError("forbidden", "forbidden", 403);
    const ch = await createChannel(db, {
      teamId: body.teamId,
      name: body.name,
      displayName: body.displayName,
      type: body.type,
      purpose: body.purpose,
      header: body.header,
      creatorId: me,
    });
    await syncChannelMember(c.env, ch.id, ch.creatorId!, "channel_admin");
    const out: CreateChannelOutput = { id: ch.id };
    return c.json(out, 201);
  },
);

channelsV1.get("/teams/:teamId/channels", requireSession, requireTeamRole("member"), async (c) => {
  const db = getDb(c.env.DB);
  const teamId = c.req.param("teamId");
  const userId = c.get("session")!.user.id;
  const all = await listChannelsForTeam(db, teamId);
  const memberRows = await db
    .select({ channelId: channelMembers.channelId })
    .from(channelMembers)
    .where(eq(channelMembers.userId, userId));
  const mine = new Set(memberRows.map((r) => r.channelId));
  const out: ChannelsForTeamOutput = {
    channels: all.map((ch) => ({
      id: ch.id,
      teamId: ch.teamId,
      name: ch.name,
      displayName: ch.displayName,
      type: ch.type as ChannelType,
      member: mine.has(ch.id),
      archivedAt: ch.archivedAt,
    })),
  };
  return c.json(out);
});

channelsV1.get("/channels/:channelId", requireSession, requireChannelRole("member"), async (c) => {
  const db = getDb(c.env.DB);
  const ch = (await getChannel(db, c.req.param("channelId")))!;
  const memberIds = await listChannelMemberIds(db, ch.id);
  const out: ChannelDetailOutput = {
    channel: {
      id: ch.id,
      displayName: ch.displayName,
      type: ch.type as ChannelType,
      purpose: ch.purpose,
      header: ch.header,
      memberCount: memberIds.length,
      archivedAt: ch.archivedAt,
    },
  };
  return c.json(out);
});

channelsV1.post("/channels/:channelId/members", requireSession, async (c) => {
  const db = getDb(c.env.DB);
  const channelId = c.req.param("channelId");
  const userId = c.get("session")!.user.id;
  const joined = await joinChannel(db, { channelId, userId });
  if (joined) {
    await syncChannelMember(c.env, channelId, userId, "channel_user");
    await syncUserChannels(c.env, userId);
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
    if (userId !== me) throw apiError("forbidden", "forbidden", 403);
    const db = getDb(c.env.DB);
    const channelId = c.req.param("channelId");
    await leaveChannel(db, { channelId, userId });
    await removeChannelMemberFromDo(c.env, channelId, userId);
    await syncUserChannels(c.env, userId);
    return c.json({ ok: true });
  },
);

channelsV1.post(
  "/channels/direct",
  requireSession,
  zodValidator("json", OpenDirectInput),
  async (c) => {
    const me = c.get("session")!.user.id;
    const body = c.req.valid("json");
    if (body.userIds.every((u) => u === me)) throw apiError("invalid", "invalid", 422);
    const withUserId = body.userIds.find((u) => u !== me);
    if (!withUserId) throw apiError("invalid", "invalid", 422);
    const db = getDb(c.env.DB);
    const { id: channelId, existing } = await openDirect(db, { userId: me, withUserId });
    if (!existing) {
      await syncChannelMember(c.env, channelId, me, "channel_user");
      await syncChannelMember(c.env, channelId, withUserId, "channel_user");
      await syncUserChannels(c.env, me);
      await syncUserChannels(c.env, withUserId);
    }
    const out: OpenChannelOutput = { id: channelId, existing };
    return c.json(out, existing ? 200 : 201);
  },
);

channelsV1.post(
  "/channels/group",
  requireSession,
  zodValidator("json", OpenGroupInput),
  async (c) => {
    const me = c.get("session")!.user.id;
    const body = c.req.valid("json");
    const userIds = body.userIds.filter((u) => u !== me);
    if (userIds.length < 2) throw apiError("invalid", "invalid", 422);
    const db = getDb(c.env.DB);
    const { id: channelId, existing } = await openGroup(db, { userId: me, userIds });
    if (!existing) {
      const ids = [...new Set([me, ...userIds])];
      for (const uid of ids) {
        await syncChannelMember(c.env, channelId, uid, "channel_user");
        await syncUserChannels(c.env, uid);
      }
    }
    const out: OpenChannelOutput = { id: channelId, existing };
    return c.json(out, existing ? 200 : 201);
  },
);

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
  zodValidator("query", ListMembersQuery),
  async (c) => {
    const db = getDb(c.env.DB);
    const query = c.req.valid("query");
    const page = query.page ?? 0;
    const perPage = query.perPage ?? 60;
    const all = await listChannelMemberIds(db, c.req.param("channelId"));
    const start = page * perPage;
    const out: ChannelsListOutput = { memberIds: all.slice(start, start + perPage) };
    return c.json(out);
  },
);

channelsV1.put(
  "/channels/:channelId/members/:userId/notifyProps",
  requireSession,
  requireChannelRole("member"),
  zodValidator("json", NotifyPropsInput),
  async (c) => {
    const body = c.req.valid("json");
    const userId = c.req.param("userId");
    const me = c.get("session")!.user.id;
    if (userId !== me && userId !== "me") throw apiError("forbidden", "forbidden", 403);
    const id = c.env.CHANNEL_DO.idFromName(channelDoName(c.req.param("channelId")));
    const res = await c.env.CHANNEL_DO.get(id).setNotifPref({
      userId: me,
      pref: body.notifyProps.pref,
    });
    if ("error" in res) throw apiError(res.error, res.error, res.status as 403 | 422);
    return c.json({ ok: true });
  },
);
