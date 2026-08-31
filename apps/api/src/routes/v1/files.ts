import { Hono } from "hono";
import type { Context } from "hono";
import { requireSession } from "../../auth/session.ts";
import type { SessionContext } from "../../auth/session.ts";
import { getDb } from "../../db/client.ts";
import { getChannelMember } from "../../db/repos/channels.ts";
import { getFileInfo, getUploadSession } from "../../db/repos/uploads.ts";
import { presignGet, type R2Env } from "../../r2.ts";

type FilesCtx = Context<{ Bindings: Env; Variables: { session: SessionContext } }>;

async function requireFileMember(c: FilesCtx, fileId: string) {
  const db = getDb(c.env.DB);
  const session = await getUploadSession(db, fileId);
  if (!session)
    return { ok: false as const, db, error: "not found" as const, status: 404 as const };
  const info = await getFileInfo(db, fileId);
  if (!info || !info.path)
    return { ok: false as const, db, error: "not found" as const, status: 404 as const };
  const member = session.channelId
    ? await getChannelMember(db, session.channelId, c.get("session")!.user.id)
    : null;
  if (!member) return { ok: false as const, db, error: "forbidden" as const, status: 403 as const };
  return { ok: true as const, db, session, info };
}

export const filesV1 = new Hono<{ Bindings: Env }>();

filesV1.get("/files/:fileId", requireSession, async (c) => {
  const fileId = c.req.param("fileId");
  const res = await requireFileMember(c, fileId);
  if (!res.ok) return c.json({ error: res.error }, res.status);
  const url = await presignGet(c.env as unknown as R2Env, res.info.path!, 3600);
  return c.redirect(url, 302);
});

filesV1.get("/files/:fileId/info", requireSession, async (c) => {
  const fileId = c.req.param("fileId");
  const res = await requireFileMember(c, fileId);
  if (!res.ok) return c.json({ error: res.error }, res.status);
  return c.json({
    id: res.info.id,
    name: res.info.name,
    size: res.info.size,
    mime_type: res.info.mimeType,
    extension: res.info.extension,
    post_id: res.info.postId,
    created_at: res.info.createdAt,
  });
});

filesV1.get("/files/:fileId/thumbnail", requireSession, async (c) => {
  const fileId = c.req.param("fileId");
  const res = await requireFileMember(c, fileId);
  if (!res.ok) return c.json({ error: res.error }, res.status);
  if (!res.info.thumbnailPath) return c.json({ error: "not found" }, 404);
  const url = await presignGet(c.env as unknown as R2Env, res.info.thumbnailPath, 3600);
  return c.redirect(url, 302);
});

filesV1.get("/files/:fileId/preview", requireSession, async (c) => {
  const fileId = c.req.param("fileId");
  const res = await requireFileMember(c, fileId);
  if (!res.ok) return c.json({ error: res.error }, res.status);
  if (!res.info.previewPath) return c.json({ error: "not found" }, 404);
  const url = await presignGet(c.env as unknown as R2Env, res.info.previewPath, 3600);
  return c.redirect(url, 302);
});
