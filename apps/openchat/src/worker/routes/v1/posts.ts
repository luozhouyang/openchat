import { Hono } from "hono";
import { channelDoName } from "protocol";
import {
  CreatePostInput,
  PatchPostInput,
  DeletePostInput,
  PinPostInput,
  ListPostsQuery,
  type PostOutput,
  type ListPostsOutput,
} from "protocol";
import { requireSession } from "@worker/auth/session";
import { requireChannelRole } from "@worker/auth/guards";
import { getDb } from "@worker/db/client";
import {
  postMessage,
  editMessage,
  deleteMessage,
  getMessageHistory,
} from "@worker/services/message.service";
import { apiError } from "@worker/lib/errors";
import { zodValidator } from "@worker/lib/validation";

export const postsV1 = new Hono<{ Bindings: Env }>();

postsV1.post(
  "/channels/:channelId/posts",
  requireSession,
  requireChannelRole("member"),
  zodValidator("json", CreatePostInput),
  async (c) => {
    const body = c.req.valid("json");
    const db = getDb(c.env.DB);
    const channelId = c.req.param("channelId");
    const { messageId, seq } = await postMessage(db, c.env, {
      channelId,
      userId: c.get("session")!.user.id,
      content: body.message,
      parentId: body.parentId,
      clientToken: body.clientToken,
    });
    const stub = c.env.CHANNEL_DO.get(c.env.CHANNEL_DO.idFromName(channelDoName(channelId)));
    const res = await stub.history({ afterSeq: seq - 1, limit: 1 });
    const msg = (res.messages as PostOutput[]).find((m) => m.id === messageId);
    const out: PostOutput = msg
      ? msg
      : {
          id: messageId,
          seq,
          userId: c.get("session")!.user.id,
          parentId: body.parentId ?? null,
          type: "text",
          content: body.message,
          mentions: null,
          editedAt: null,
          deletedAt: null,
          createdAt: Date.now(),
          // Fallback only runs when the DO history round trip missed; a fresh
          // post is never pinned.
          isPinned: false,
        };
    return c.json(out, 201);
  },
);
postsV1.get(
  "/channels/:channelId/posts",
  requireSession,
  requireChannelRole("member"),
  zodValidator("query", ListPostsQuery),
  async (c) => {
    const body = c.req.valid("query");
    const channelId = c.req.param("channelId");
    const res = await getMessageHistory(c.env, {
      channelId,
      limit: body.limit,
      beforeSeq: body.beforeSeq,
      parentId: body.parentId,
      order: body.order,
    });
    const out: ListPostsOutput = {
      messages: res.messages,
      oldestSeq: res.oldestSeq,
    };
    return c.json(out);
  },
);
postsV1.put(
  "/posts/:postId/patch",
  requireSession,
  zodValidator("json", PatchPostInput),
  async (c) => {
    const body = c.req.valid("json");
    const db = getDb(c.env.DB);
    await editMessage(db, c.env, {
      channelId: body.channelId,
      callerUserId: c.get("session")!.user.id,
      messageId: c.req.param("postId"),
      content: body.message,
    });
    return c.json({ ok: true });
  },
);
postsV1.delete(
  "/posts/:postId",
  requireSession,
  zodValidator("json", DeletePostInput),
  async (c) => {
    const body = c.req.valid("json");
    const db = getDb(c.env.DB);
    await deleteMessage(db, c.env, {
      channelId: body.channelId,
      callerUserId: c.get("session")!.user.id,
      messageId: c.req.param("postId"),
    });
    return c.json({ ok: true });
  },
);
postsV1.post(
  "/posts/:postId/pin",
  requireSession,
  zodValidator("json", PinPostInput),
  async (c) => {
    const body = c.req.valid("json");
    const stub = c.env.CHANNEL_DO.get(c.env.CHANNEL_DO.idFromName(channelDoName(body.channelId)));
    const res = await stub.pinMessage(c.get("session")!.user.id, {
      messageId: c.req.param("postId"),
      pinned: true,
    });
    if ("error" in res) {
      throw apiError(res.error, res.error, res.status);
    }
    return c.json({ ok: true });
  },
);
postsV1.post(
  "/posts/:postId/unpin",
  requireSession,
  zodValidator("json", PinPostInput),
  async (c) => {
    const body = c.req.valid("json");
    const stub = c.env.CHANNEL_DO.get(c.env.CHANNEL_DO.idFromName(channelDoName(body.channelId)));
    const res = await stub.pinMessage(c.get("session")!.user.id, {
      messageId: c.req.param("postId"),
      pinned: false,
    });
    if ("error" in res) {
      throw apiError(res.error, res.error, res.status);
    }
    return c.json({ ok: true });
  },
);
