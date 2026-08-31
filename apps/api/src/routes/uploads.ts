import { Hono } from "hono";
import { z } from "zod";
import { id } from "protocol";
import { requireSession } from "../auth/session.ts";
import { getDb } from "../db/client.ts";
import { getChannel, getChannelMember } from "../db/repos/channels.ts";
import { createUpload, getUpload, completeUpload } from "../db/repos/uploads.ts";
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
  await createUpload(db, {
    id: uploadId,
    channelId: body.data.channelId,
    userId,
    key,
    filename,
    size: body.data.size,
    contentType: body.data.contentType,
  });
  const putUrl = await presignPut(c.env as unknown as R2Env, key, body.data.contentType, 900);
  return c.json({ uploadId, putUrl }, 201);
});

uploadsRoutes.post("/uploads/complete", requireSession, async (c) => {
  const body = z.object({ uploadId: z.string().min(1) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const db = getDb(c.env.DB);
  const upload = await getUpload(db, body.data.uploadId);
  if (!upload) return c.json({ error: "not found" }, 404);
  if (upload.status !== "pending") return c.json({ error: "already processed" }, 409);

  const obj = await headObject(c.env.FILES, upload.key);
  if (!obj) return c.json({ error: "object missing" }, 404);
  if (obj.size !== upload.size) return c.json({ error: "size mismatch" }, 422);
  if (obj.contentType !== upload.contentType) return c.json({ error: "type mismatch" }, 422);

  await completeUpload(db, upload.id);
  const messageId = await postFileMessage(c.env, upload.channelId, upload.userId, {
    fileId: upload.id,
    key: upload.key,
    name: upload.filename,
    size: upload.size,
    mime: upload.contentType,
  });
  return c.json({ messageId }, 201);
});
