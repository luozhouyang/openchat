import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { CreateChannelInput, OpenDmInput, OpenGmInput, channelDoName } from "protocol";
import { requireSession } from "../auth/session.ts";
import { requireTeamRole, requireChannelRole } from "../auth/guards.ts";
import { getDb } from "../db/client.ts";
import { channelMembers } from "../db/schema-d1.ts";
import { listChannelsForTeam, getChannel, listChannelMemberIds } from "../db/repos/channels.ts";
import {
  createChannel,
  openDirect,
  openGroup,
  joinChannel,
  leaveChannel,
  archiveChannel,
} from "../services/channel.service.ts";
import { HttpError } from "../lib/errors.ts";
import { syncChannelMember, syncUserChannels, removeChannelMemberFromDo } from "../user-do-sync.ts";

export const channelsRoutes = new Hono<{ Bindings: Env }>();

channelsRoutes.post(
  "/teams/:teamId/channels",
  requireSession,
  requireTeamRole("member"),
  async (c) => {
    const body = CreateChannelInput.safeParse(await c.req.json());
    if (!body.success) return c.json({ error: "invalid" }, 422);
    const db = getDb(c.env.DB);
    try {
      const ch = await createChannel(db, {
        teamId: c.req.param("teamId"),
        name: body.data.name,
        displayName: body.data.displayName,
        type: body.data.type,
        creatorId: c.get("session")!.user.id,
      });
      await syncChannelMember(c.env, ch.id, ch.creatorId!, "channel_admin");
      return c.json({ id: ch.id }, 201);
    } catch (err) {
      if (err instanceof HttpError)
        return c.json({ error: err.code }, err.status as ContentfulStatusCode);
      throw err;
    }
  },
);

channelsRoutes.get(
  "/teams/:teamId/channels",
  requireSession,
  requireTeamRole("member"),
  async (c) => {
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
  },
);

channelsRoutes.post("/channels/:channelId/join", requireSession, async (c) => {
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

channelsRoutes.post(
  "/channels/:channelId/leave",
  requireSession,
  requireChannelRole("member"),
  async (c) => {
    const db = getDb(c.env.DB);
    const channelId = c.req.param("channelId");
    const userId = c.get("session")!.user.id;
    await leaveChannel(db, { channelId, userId });
    await removeChannelMemberFromDo(c.env, channelId, userId);
    await syncUserChannels(c.env, userId);
    return c.json({ ok: true });
  },
);

channelsRoutes.get(
  "/channels/:channelId",
  requireSession,
  requireChannelRole("member"),
  async (c) => {
    const db = getDb(c.env.DB);
    const ch = (await getChannel(db, c.req.param("channelId")))!;
    const memberIds = await listChannelMemberIds(db, ch.id);
    return c.json({
      id: ch.id,
      displayName: ch.displayName,
      type: ch.type,
      memberCount: memberIds.length,
      archivedAt: ch.archivedAt,
    });
  },
);

channelsRoutes.get(
  "/channels/:channelId/history",
  requireSession,
  requireChannelRole("member"),
  async (c) => {
    const channelId = c.req.param("channelId");
    const limit = Math.min(Number(c.req.query("limit")) || 30, 500);
    const beforeSeq = c.req.query("before_seq") ? Number(c.req.query("before_seq")) : undefined;
    const parentId = c.req.query("parent_id") || undefined;
    const order = c.req.query("order") === "asc" ? "asc" : undefined;
    const stub = c.env.CHANNEL_DO.get(c.env.CHANNEL_DO.idFromName(channelDoName(channelId)));
    const res = await stub.history({ limit, beforeSeq, parentId, order });
    return c.json({ messages: res.messages, oldestSeq: res.oldestSeq });
  },
);

channelsRoutes.post(
  "/channels/:channelId/messages/:messageId/edit",
  requireSession,
  requireChannelRole("member"),
  async (c) => {
    const body = z.object({ content: z.string().min(1).max(16384) }).safeParse(await c.req.json());
    if (!body.success) return c.json({ error: "invalid" }, 422);
    const userId = c.get("session")!.user.id;
    const stub = c.env.CHANNEL_DO.get(
      c.env.CHANNEL_DO.idFromName(channelDoName(c.req.param("channelId"))),
    );
    const res = await stub.editMessage(userId, {
      messageId: c.req.param("messageId"),
      content: body.data.content,
    });
    if ("error" in res) return c.json({ error: res.error }, res.status);
    return c.json({ ok: true });
  },
);

channelsRoutes.post(
  "/channels/:channelId/messages/:messageId/delete",
  requireSession,
  requireChannelRole("member"),
  async (c) => {
    const userId = c.get("session")!.user.id;
    const stub = c.env.CHANNEL_DO.get(
      c.env.CHANNEL_DO.idFromName(channelDoName(c.req.param("channelId"))),
    );
    const res = await stub.deleteMessage(userId, { messageId: c.req.param("messageId") });
    if ("error" in res) return c.json({ error: res.error }, res.status);
    return c.json({ ok: true });
  },
);

channelsRoutes.post(
  "/channels/:channelId/archive",
  requireSession,
  requireChannelRole("admin"),
  async (c) => {
    const db = getDb(c.env.DB);
    await archiveChannel(db, { channelId: c.req.param("channelId") });
    return c.json({ ok: true });
  },
);

channelsRoutes.post(
  "/channels/:channelId/notify-pref",
  requireSession,
  requireChannelRole("member"),
  async (c) => {
    const body = z
      .object({ pref: z.enum(["all", "mention", "none"]) })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: "invalid" }, 422);
    const userId = c.get("session")!.user.id;
    const id = c.env.CHANNEL_DO.idFromName(channelDoName(c.req.param("channelId")));
    const res = await c.env.CHANNEL_DO.get(id).setNotifPref({ userId, pref: body.data.pref });
    if ("error" in res) return c.json({ error: res.error }, res.status);
    return c.json({ ok: true });
  },
);

channelsRoutes.post("/channels/dm", requireSession, async (c) => {
  const body = OpenDmInput.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const me = c.get("session")!.user.id;
  if (body.data.withUserId === me) return c.json({ error: "invalid" }, 422);
  const db = getDb(c.env.DB);
  try {
    const { id: channelId, existing } = await openDirect(db, {
      userId: me,
      withUserId: body.data.withUserId,
    });
    if (!existing) {
      await syncChannelMember(c.env, channelId, me, "channel_user");
      await syncChannelMember(c.env, channelId, body.data.withUserId, "channel_user");
      await syncUserChannels(c.env, me);
      await syncUserChannels(c.env, body.data.withUserId);
    }
    return c.json({ id: channelId, existing }, existing ? 200 : 201);
  } catch (err) {
    if (err instanceof HttpError)
      return c.json({ error: err.code }, err.status as ContentfulStatusCode);
    throw err;
  }
});

channelsRoutes.post("/channels/gm", requireSession, async (c) => {
  const body = OpenGmInput.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const me = c.get("session")!.user.id;
  const db = getDb(c.env.DB);
  try {
    const { id: channelId, existing } = await openGroup(db, {
      userId: me,
      userIds: body.data.userIds,
    });
    if (!existing) {
      const ids = [...new Set([me, ...body.data.userIds])];
      for (const userId of ids) {
        await syncChannelMember(c.env, channelId, userId, "channel_user");
        await syncUserChannels(c.env, userId);
      }
    }
    return c.json({ id: channelId, existing }, existing ? 200 : 201);
  } catch (err) {
    if (err instanceof HttpError)
      return c.json({ error: err.code }, err.status as ContentfulStatusCode);
    throw err;
  }
});
