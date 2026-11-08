import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import { channelDoName, isAllowedEmoji } from "protocol";
import { AddReactionInput, ReactionsQuery, type ReactionsOutput } from "protocol";
import type { SessionContext } from "@worker/auth/session";
import { requireSession } from "@worker/auth/session";
import { getDb } from "@worker/db/client";
import { users } from "@worker/db/schema-d1";
import { getChannel, getChannelMember } from "@worker/db/repos/channels";
import { apiError } from "@worker/lib/errors";
import { zodValidator } from "@worker/lib/validation";

type ReactionsCtx = Context<{ Bindings: Env; Variables: { session: SessionContext } }>;

export const reactionsV1 = new Hono<{ Bindings: Env }>();

function channelStub(env: Env, channelId: string) {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
}

async function requireChannelMember(c: ReactionsCtx, channelId: string) {
  const db = getDb(c.env.DB);
  const channel = await getChannel(db, channelId);
  if (!channel) {
    throw apiError("not found", "channel not found", 404);
  }
  const member = await getChannelMember(db, channelId, c.get("session")!.user.id);
  if (!member) {
    throw apiError("forbidden", "forbidden", 403);
  }
}

reactionsV1.post(
  "/reactions",
  requireSession,
  zodValidator("json", AddReactionInput),
  async (c) => {
    const body = c.req.valid("json");
    if (!isAllowedEmoji(body.emojiName)) {
      throw apiError("invalid emoji", "invalid emoji", 422);
    }
    await requireChannelMember(c, body.channelId);
    const res = await channelStub(c.env, body.channelId).toggleReactionByMessageId(
      c.get("session")!.user.id,
      { messageId: body.postId, emoji: body.emojiName },
    );
    if (res && "error" in res) {
      throw apiError(res.error, res.error, res.status);
    }
    return c.json({ ok: true });
  },
);
reactionsV1.get(
  "/posts/:postId/reactions",
  requireSession,
  zodValidator("query", ReactionsQuery),
  async (c) => {
    const body = c.req.valid("query");
    await requireChannelMember(c, body.channelId);
    const res = await channelStub(c.env, body.channelId).reactionSnapshotByMessageId(
      c.req.param("postId"),
    );
    if ("error" in res) {
      const err = res as { error: string; status: number };
      throw apiError(err.error, err.error, err.status);
    }
    const out: ReactionsOutput = { reactions: res };
    return c.json(out);
  },
);
reactionsV1.delete(
  "/users/:userId/posts/:postId/reactions/:emojiName",
  requireSession,
  zodValidator("query", ReactionsQuery),
  async (c) => {
    const body = c.req.valid("query");
    await requireChannelMember(c, body.channelId);
    const db = getDb(c.env.DB);
    const me = c.get("session")!.user.id;
    const target = c.req.param("userId") === "me" ? me : c.req.param("userId");
    const roleRows = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, me))
      .limit(1);
    const role = roleRows[0]?.role;
    if (target !== me && role !== "admin") {
      throw apiError("forbidden", "forbidden", 403);
    }
    const emoji = c.req.param("emojiName");
    if (!isAllowedEmoji(emoji)) {
      throw apiError("invalid emoji", "invalid emoji", 422);
    }
    const stub = channelStub(c.env, body.channelId);
    // Keep the current 404-on-missing semantics of this endpoint (the delete
    // route has always 404'd when the target has no such reaction, unlike the
    // plain toggle on POST /reactions which is 200/idempotent for the caller).
    const snapshot = await stub.reactionSnapshotByMessageId(c.req.param("postId"));
    if ("error" in snapshot) {
      const err = snapshot as { error: string; status: number };
      throw apiError(err.error, err.error, err.status);
    }
    if (!(snapshot[emoji] ?? []).includes(target)) {
      throw apiError("not found", "not found", 404);
    }
    // Remove the TARGET user's reaction — the old code toggled the caller's
    // own reaction here (admin deleting someone else's emoji deleted their
    // own instead). removeReactionByMessageId is the ChannelDO contract for
    // admin-semantic targeted removal; it is validated (message + emoji) and
    // no-ops when the (target, emoji) pair has nothing to remove.
    const removed = await stub.removeReactionByMessageId(target, c.req.param("postId"), emoji);
    if (!removed) {
      // Same 404 the snapshot check reports: the (target, emoji) pair vanished
      // between the snapshot read and the removal (rare race), or the DO
      // refused (message/emoji invalidation). Never a "success that removed
      // the caller's own row".
      throw apiError("not found", "not found", 404);
    }
    return c.json({ ok: true });
  },
);
