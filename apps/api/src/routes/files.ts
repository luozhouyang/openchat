import { Hono } from "hono";
import { requireSession } from "../auth/session.ts";
import { getDb } from "../db/client.ts";
import { getChannelMember } from "../db/repos/channels.ts";
import { getFileInfo, getUploadSession } from "../db/repos/uploads.ts";
import { presignGet, type R2Env } from "../r2.ts";

export const filesRoutes = new Hono<{ Bindings: Env }>();

filesRoutes.get("/files/:channelId/:fileId", requireSession, async (c) => {
  const db = getDb(c.env.DB);
  const userId = c.get("session")!.user.id;
  const member = await getChannelMember(db, c.req.param("channelId"), userId);
  if (!member) return c.json({ error: "forbidden" }, 403);
  const info = await getFileInfo(db, c.req.param("fileId"));
  if (!info || !info.path) return c.json({ error: "not found" }, 404);
  const session = await getUploadSession(db, c.req.param("fileId"));
  if (!session || session.channelId !== c.req.param("channelId"))
    return c.json({ error: "not found" }, 404);
  const url = await presignGet(c.env as unknown as R2Env, info.path, 3600);
  return c.redirect(url, 302);
});
