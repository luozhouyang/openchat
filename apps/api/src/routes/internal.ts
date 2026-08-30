import { Hono } from "hono";
import { channelDoName } from "protocol";
import { getDb } from "../db/client.ts";
import { getUpload } from "../db/repos/uploads.ts";

export const internalRoutes = new Hono<{ Bindings: Env }>();

internalRoutes.post("/internal/thumbnail", async (c) => {
  if (c.req.header("x-internal-token") !== c.env.INTERNAL_TOKEN_KEY) {
    return c.json({ error: "forbidden" }, 403);
  }
  const body = (await c.req.json()) as { channelId: string; uploadId: string; thumbKey: string };
  const db = getDb(c.env.DB);
  const upload = await getUpload(db, body.uploadId);
  if (!upload || upload.status !== "complete") return c.json({ error: "not found" }, 404);
  const id = c.env.CHANNEL_DO.idFromName(channelDoName(body.channelId));
  await c.env.CHANNEL_DO.get(id).updateThumbByUpload({
    uploadId: body.uploadId,
    thumbUrl: `/files/${body.channelId}/${body.uploadId}?thumb=1`,
    thumbKey: body.thumbKey,
  });
  return c.json({ ok: true });
});
