import { Hono, type Context } from "hono";
import { type FileInfoOutput } from "protocol";
import type { SessionContext } from "@worker/auth/session";
import { requireSession } from "@worker/auth/session";
import { getDb } from "@worker/db/client";
import { getChannelMember } from "@worker/db/repos/channels";
import { getFileInfo, getUploadSession } from "@worker/db/repos/uploads";
import { presignGet, type R2Env } from "@worker/r2";
import { apiError } from "@worker/lib/errors";

type FilesCtx = Context<{ Bindings: Env; Variables: { session: SessionContext } }>;

async function requireFileMember(c: FilesCtx, fileId: string) {
  const db = getDb(c.env.DB);
  const session = await getUploadSession(db, fileId);
  if (!session) {
    return { ok: false as const, error: "not found" as const, status: 404 as const };
  }
  const info = await getFileInfo(db, fileId);
  if (!info || !info.path) {
    return { ok: false as const, error: "not found" as const, status: 404 as const };
  }
  const member = session.channelId
    ? await getChannelMember(db, session.channelId, c.get("session")!.user.id)
    : null;
  if (!member) {
    return { ok: false as const, error: "forbidden" as const, status: 403 as const };
  }
  return { ok: true as const, db, session, info };
}

export const filesV1 = new Hono<{ Bindings: Env }>();

filesV1.get("/files/:fileId", requireSession, async (c) => {
  const fileId = c.req.param("fileId");
  const res = await requireFileMember(c, fileId);
  if (!res.ok) {
    throw apiError(res.error, res.error, res.status);
  }
  const url = await presignGet(c.env as unknown as R2Env, res.info.path!, 3600);
  return c.redirect(url, 302);
});
filesV1.get("/files/:fileId/info", requireSession, async (c) => {
  const fileId = c.req.param("fileId");
  const res = await requireFileMember(c, fileId);
  if (!res.ok) {
    throw apiError(res.error, res.error, res.status);
  }
  const out: FileInfoOutput = {
    id: res.info.id,
    name: res.info.name,
    size: res.info.size,
    mimeType: res.info.mimeType,
    extension: res.info.extension,
    postId: res.info.postId,
    createdAt: res.info.createdAt,
  };
  return c.json(out);
});
filesV1.get("/files/:fileId/thumbnail", requireSession, async (c) => {
  const fileId = c.req.param("fileId");
  const res = await requireFileMember(c, fileId);
  if (!res.ok) {
    throw apiError(res.error, res.error, res.status);
  }
  if (!res.info.thumbnailPath) {
    throw apiError("not found", "not found", 404);
  }
  const url = await presignGet(c.env as unknown as R2Env, res.info.thumbnailPath, 3600);
  return c.redirect(url, 302);
});
filesV1.get("/files/:fileId/preview", requireSession, async (c) => {
  const fileId = c.req.param("fileId");
  const res = await requireFileMember(c, fileId);
  if (!res.ok) {
    throw apiError(res.error, res.error, res.status);
  }
  if (!res.info.previewPath) {
    throw apiError("not found", "not found", 404);
  }
  const url = await presignGet(c.env as unknown as R2Env, res.info.previewPath, 3600);
  return c.redirect(url, 302);
});
