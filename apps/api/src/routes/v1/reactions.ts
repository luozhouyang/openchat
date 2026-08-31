import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import { channelDoName, isAllowedEmoji } from "protocol";
import { AddReactionInput, ReactionsQuery, type ReactionsOutput } from "protocol";
import type { SessionContext } from "../../auth/session.ts";
import { requireSession } from "../../auth/session.ts";
import { getDb } from "../../db/client.ts";
import { users } from "../../db/schema-d1.ts";
import { getChannel, getChannelMember } from "../../db/repos/channels.ts";
import { apiError } from "../../lib/errors.ts";
import { zodValidator } from "../../lib/validation.ts";

type ReactionsCtx = Context<{ Bindings: Env; Variables: { session: SessionContext } }>;

export const reactionsV1 = new Hono<{ Bindings: Env }>();

function channelStub(env: Env, channelId: string) {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
}

async function requireChannelMember(c: ReactionsCtx, channelId: string) {
  const db = getDb(c.env.DB);
  const channel = await getChannel(db, channelId);
  if (!channel) throw apiError("not found", "channel not found", 404);
  const member = await getChannelMember(db, channelId, c.get("session")!.user.id);
  if (!member) throw apiError("forbidden", "forbidden", 403);
}

reactionsV1.post(
  "/reactions",
  requireSession,
  zodValidator("json", AddReactionInput),
  async (c) => {
    const body = c.req.valid("json");
    if (!isAllowedEmoji(body.emojiName)) throw apiError("invalid emoji", "invalid emoji", 422);
    await requireChannelMember(c, body.channelId);
    const res = await channelStub(c.env, body.channelId).toggleReactionByMessageId(
      c.get("session")!.user.id,
      { messageId: body.postId, emoji: body.emojiName },
    );
    if (res && "error" in res) throw apiError(res.error, res.error, res.status);
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
    if (target !== me && role !== "admin") throw apiError("forbidden", "forbidden", 403);
    const emoji = c.req.param("emojiName");
    if (!isAllowedEmoji(emoji)) throw apiError("invalid emoji", "invalid emoji", 422);
    const stub = channelStub(c.env, body.channelId);
    const snapshot = await stub.reactionSnapshotByMessageId(c.req.param("postId"));
    if ("error" in snapshot) {
      const err = snapshot as { error: string; status: number };
      throw apiError(err.error, err.error, err.status);
    }
    if (!(snapshot[emoji] ?? []).includes(target)) throw apiError("not found", "not found", 404);
    const res = await stub.toggleReactionByMessageId(me, {
      messageId: c.req.param("postId"),
      emoji,
    });
    if (res && "error" in res) throw apiError(res.error, res.error, res.status);
    return c.json({ ok: true });
  },
);
