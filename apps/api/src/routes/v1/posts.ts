import { Hono } from "hono";
import { z } from "zod";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { channelDoName } from "protocol";
import { requireSession } from "../../auth/session.ts";
import { requireChannelRole } from "../../auth/guards.ts";
import { getDb } from "../../db/client.ts";
import {
  postMessageService,
  editMessageService,
  deleteMessageService,
  messageHistory,
} from "../../services/message.service.ts";
import { HttpError } from "../../lib/errors.ts";

const CreatePostBody = z.object({
  message: z.string().min(1).max(16384),
  parent_id: z.string().min(1).optional(),
  client_token: z.string().min(1).max(64).optional(),
});

const PatchPostBody = z.object({
  message: z.string().min(1).max(16384),
  channel_id: z.string().min(1),
});

const DeletePostBody = z.object({
  channel_id: z.string().min(1),
});

export const postsV1 = new Hono<{ Bindings: Env }>();

postsV1.post(
  "/channels/:channelId/posts",
  requireSession,
  requireChannelRole("member"),
  async (c) => {
    const body = CreatePostBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid" }, 422);
    const db = getDb(c.env.DB);
    const channelId = c.req.param("channelId");
    try {
      const { messageId, seq } = await postMessageService(db, c.env, {
        channelId,
        userId: c.get("session")!.user.id,
        content: body.data.message,
        parentId: body.data.parent_id,
        clientToken: body.data.client_token,
      });
      const stub = c.env.CHANNEL_DO.get(c.env.CHANNEL_DO.idFromName(channelDoName(channelId)));
      const res = await stub.history({ afterSeq: seq - 1, limit: 1 });
      const msg = res.messages.find((m) => m.id === messageId) ?? { id: messageId, seq };
      return c.json(msg, 201);
    } catch (err) {
      if (err instanceof HttpError)
        return c.json({ error: err.code }, err.status as ContentfulStatusCode);
      throw err;
    }
  },
);

postsV1.get(
  "/channels/:channelId/posts",
  requireSession,
  requireChannelRole("member"),
  async (c) => {
    const channelId = c.req.param("channelId");
    const q = new URL(c.req.url).searchParams;
    const limit = Math.min(Number(q.get("limit")) || Number(q.get("per_page")) || 30, 500);
    const beforeSeq = q.get("before_seq") ? Number(q.get("before_seq")) : undefined;
    const parentId = q.get("parent_id") || undefined;
    const order = q.get("order") === "asc" ? "asc" : undefined;
    const res = await messageHistory(c.env, { channelId, limit, beforeSeq, parentId, order });
    return c.json({ messages: res.messages, oldestSeq: res.oldestSeq });
  },
);

postsV1.put("/posts/:postId/patch", requireSession, async (c) => {
  const body = PatchPostBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const db = getDb(c.env.DB);
  try {
    await editMessageService(db, c.env, {
      channelId: body.data.channel_id,
      callerUserId: c.get("session")!.user.id,
      messageId: c.req.param("postId"),
      content: body.data.message,
    });
  } catch (err) {
    if (err instanceof HttpError)
      return c.json({ error: err.code }, err.status as ContentfulStatusCode);
    throw err;
  }
  return c.json({ ok: true });
});

postsV1.delete("/posts/:postId", requireSession, async (c) => {
  const body = DeletePostBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const db = getDb(c.env.DB);
  try {
    await deleteMessageService(db, c.env, {
      channelId: body.data.channel_id,
      callerUserId: c.get("session")!.user.id,
      messageId: c.req.param("postId"),
    });
  } catch (err) {
    if (err instanceof HttpError)
      return c.json({ error: err.code }, err.status as ContentfulStatusCode);
    throw err;
  }
  return c.json({ ok: true });
});
