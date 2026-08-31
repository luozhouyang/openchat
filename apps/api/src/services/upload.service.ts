import { id } from "protocol";
import { getDb } from "../db/client.ts";
import { getChannel, getChannelMember } from "../db/repos/channels.ts";
import {
  createUploadSession,
  getUploadSession,
  completeUploadSession,
  createFileInfo,
  linkFileToPost,
} from "../db/repos/uploads.ts";
import { apiError } from "../lib/errors.ts";
import { sanitizeFilename, presignPut, headObject, type R2Env } from "../r2.ts";
import { postFileMessage } from "../user-do-sync.ts";

type Db = ReturnType<typeof getDb>;

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

function extensionOf(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1) : null;
}

export async function createUpload(
  db: Db,
  env: Env,
  {
    channelId,
    userId,
    filename,
    size,
    contentType,
  }: {
    channelId: string;
    userId: string;
    filename: string;
    size: number;
    contentType: string;
  },
) {
  const channel = await getChannel(db, channelId);
  if (!channel) throw apiError("channel not found", "channel not found", 404);
  if (channel.archivedAt !== null) throw apiError("archived", "archived", 403);
  const member = await getChannelMember(db, channelId, userId);
  if (!member) throw apiError("forbidden", "not a member", 403);

  if (size > MAX_SIZE) throw apiError("too large", "too large", 422);
  if (!ALLOWED_TYPES.has(contentType)) throw apiError("type not allowed", "type not allowed", 422);

  const uploadId = id("upl");
  const safeName = sanitizeFilename(filename);
  const key = `uploads/${channelId}/${uploadId}/${safeName}`;
  await createUploadSession(db, {
    id: uploadId,
    type: contentType,
    userId,
    channelId,
    filename: safeName,
    path: key,
    fileSize: size,
  });
  const putUrl = await presignPut(env as unknown as R2Env, key, contentType, 900);
  return { uploadId, putUrl };
}

export async function completeUpload(
  db: Db,
  env: Env,
  { uploadId, userId }: { uploadId: string; userId: string },
) {
  const session = await getUploadSession(db, uploadId);
  if (!session) throw apiError("not found", "not found", 404);
  if (session.userId !== userId) throw apiError("forbidden", "not your upload", 403);
  if (session.fileOffset === session.fileSize)
    throw apiError("already processed", "already processed", 409);
  if (!session.path) throw apiError("not found", "not found", 404);

  const obj = await headObject(env.FILES, session.path);
  if (!obj) throw apiError("object missing", "object missing", 404);
  if (obj.size !== session.fileSize) throw apiError("size mismatch", "size mismatch", 422);
  if (obj.contentType !== session.type) throw apiError("type mismatch", "type mismatch", 422);

  await completeUploadSession(db, session.id, { fileOffset: session.fileSize ?? 0 });
  const messageId = await postFileMessage(env, session.channelId!, session.userId!, {
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
  return { messageId };
}
