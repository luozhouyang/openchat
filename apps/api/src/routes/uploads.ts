import { Hono } from "hono";
import { z } from "zod";
import { id } from "protocol";
import { requireSession } from "../auth/session.ts";
import { getDb } from "../db/client.ts";
import { getChannel, getChannelMember } from "../db/repos/channels.ts";
import {
  createUploadSession,
  getUploadSession,
  completeUploadSession,
  createFileInfo,
  linkFileToPost,
} from "../db/repos/uploads.ts";
import { sanitizeFilename, presignPut, headObject, type R2Env } from "../r2.ts";
import { postFileMessage } from "../user-do-sync.ts";

const MAX_SIZE = 100 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/json",
  "application/zip",
  "video/mp4",
  "audio/mpeg",
]);

const UploadRequest = z.object({
  channelId: z.string().min(1),
  filename: z.string().min(1).max(512),
  size: z.number().int().positive(),
  contentType: z.string().min(1),
});

function extensionOf(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1) : null;
}

export const uploadsRoutes = new Hono<{ Bindings: Env }>();

uploadsRoutes.post("/uploads", requireSession, async (c) => {
  const body = UploadRequest.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const userId = c.get("session")!.user.id;
  const db = getDb(c.env.DB);

  const channel = await getChannel(db, body.data.channelId);
  if (!channel) return c.json({ error: "channel not found" }, 404);
  if (channel.archivedAt !== null) return c.json({ error: "archived" }, 403);
  const member = await getChannelMember(db, body.data.channelId, userId);
  if (!member) return c.json({ error: "forbidden" }, 403);

  if (body.data.size > MAX_SIZE) return c.json({ error: "too large" }, 422);
  if (!ALLOWED_TYPES.has(body.data.contentType)) return c.json({ error: "type not allowed" }, 422);

  const uploadId = id("upl");
  const filename = sanitizeFilename(body.data.filename);
  const key = `uploads/${body.data.channelId}/${uploadId}/${filename}`;
  await createUploadSession(db, {
    id: uploadId,
    type: body.data.contentType,
    userId,
    channelId: body.data.channelId,
    filename,
    path: key,
    fileSize: body.data.size,
  });
  const putUrl = await presignPut(c.env as unknown as R2Env, key, body.data.contentType, 900);
  return c.json({ uploadId, putUrl }, 201);
});

uploadsRoutes.post("/uploads/complete", requireSession, async (c) => {
  const body = z.object({ uploadId: z.string().min(1) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const db = getDb(c.env.DB);
  const session = await getUploadSession(db, body.data.uploadId);
  if (!session) return c.json({ error: "not found" }, 404);
  if (session.fileOffset === session.fileSize) return c.json({ error: "already processed" }, 409);
  if (!session.path) return c.json({ error: "not found" }, 404);

  const obj = await headObject(c.env.FILES, session.path);
  if (!obj) return c.json({ error: "object missing" }, 404);
  if (obj.size !== session.fileSize) return c.json({ error: "size mismatch" }, 422);
  if (obj.contentType !== session.type) return c.json({ error: "type mismatch" }, 422);

  await completeUploadSession(db, session.id, { fileOffset: session.fileSize ?? 0 });
  const messageId = await postFileMessage(c.env, session.channelId!, session.userId!, {
    fileId: session.id,
    key: session.path,
    name: session.filename ?? "file",
    size: session.fileSize ?? 0,
    mime: session.type ?? "application/octet-stream",
  });
  await createFileInfo(db, {
    id: session.id,
    creatorId: session.userId,
    postId: null,
    path: session.path,
    name: session.filename,
    extension: session.filename ? extensionOf(session.filename) : null,
    size: session.fileSize,
    mimeType: session.type,
    createdAt: Date.now(),
  });
  await linkFileToPost(db, { fileId: session.id, postId: messageId });
  return c.json({ messageId }, 201);
});
