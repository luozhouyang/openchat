import { Hono } from "hono";
import { z } from "zod";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { eq } from "drizzle-orm";
import { channelDoName, isAllowedEmoji } from "protocol";
import { requireSession } from "../../auth/session.ts";
import type { SessionContext } from "../../auth/session.ts";
import { getDb } from "../../db/client.ts";
import { users } from "../../db/schema-d1.ts";
import { getChannel, getChannelMember } from "../../db/repos/channels.ts";

const AddReactionBody = z.object({
  post_id: z.string().min(1),
  emoji_name: z.string().min(1),
  channel_id: z.string().min(1),
});

type ReactionsCtx = Context<{ Bindings: Env; Variables: { session: SessionContext } }>;

function channelStub(env: Env, channelId: string) {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
}

async function requireChannelMember(c: ReactionsCtx, channelId: string): Promise<Response | null> {
  const db = getDb(c.env.DB);
  const channel = await getChannel(db, channelId);
  if (!channel) return c.json({ error: "channel not found" }, 404);
  const member = await getChannelMember(db, channelId, c.get("session")!.user.id);
  if (!member) return c.json({ error: "forbidden" }, 403);
  return null;
}

export const reactionsV1 = new Hono<{ Bindings: Env }>();

reactionsV1.post("/reactions", requireSession, async (c) => {
  const body = AddReactionBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 422);
  if (!isAllowedEmoji(body.data.emoji_name)) return c.json({ error: "invalid emoji" }, 422);
  const denied = await requireChannelMember(c, body.data.channel_id);
  if (denied) return denied;
  const stub = channelStub(c.env, body.data.channel_id);
  const res = await stub.toggleReactionByMessageId(c.get("session")!.user.id, {
    messageId: body.data.post_id,
    emoji: body.data.emoji_name,
  });
  if (res && "error" in res)
    return c.json({ error: res.error }, res.status as ContentfulStatusCode);
  return c.json({ ok: true });
});

reactionsV1.get("/posts/:postId/reactions", requireSession, async (c) => {
  const channelId = new URL(c.req.url).searchParams.get("channel_id");
  if (!channelId) return c.json({ error: "invalid" }, 422);
  const denied = await requireChannelMember(c, channelId);
  if (denied) return denied;
  const stub = channelStub(c.env, channelId);
  const res = await stub.reactionSnapshotByMessageId(c.req.param("postId")!);
  if ("error" in res) return c.json({ error: res.error }, res.status as ContentfulStatusCode);
  return c.json({ reactions: res });
});

reactionsV1.delete(
  "/users/:userId/posts/:postId/reactions/:emojiName",
  requireSession,
  async (c) => {
    const channelId = new URL(c.req.url).searchParams.get("channel_id");
    if (!channelId) return c.json({ error: "invalid" }, 422);
    const denied = await requireChannelMember(c, channelId);
    if (denied) return denied;
    const db = getDb(c.env.DB);
    const me = c.get("session")!.user.id;
    const target = c.req.param("userId")! === "me" ? me : c.req.param("userId")!;
    const rows = await db.select({ role: users.role }).from(users).where(eq(users.id, me)).limit(1);
    if (target !== me && rows[0]?.role !== "admin") return c.json({ error: "forbidden" }, 403);
    const emoji = c.req.param("emojiName")!;
    if (!isAllowedEmoji(emoji)) return c.json({ error: "invalid emoji" }, 422);
    const stub = channelStub(c.env, channelId);
    const snapshot = await stub.reactionSnapshotByMessageId(c.req.param("postId")!);
    if ("error" in snapshot)
      return c.json({ error: snapshot.error }, snapshot.status as ContentfulStatusCode);
    if (!(snapshot[emoji] ?? []).includes(target)) return c.json({ error: "not found" }, 404);
    const res = await stub.toggleReactionByMessageId(me, {
      messageId: c.req.param("postId")!,
      emoji,
    });
    if (res && "error" in res)
      return c.json({ error: res.error }, res.status as ContentfulStatusCode);
    return c.json({ ok: true });
  },
);
