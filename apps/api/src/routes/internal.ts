import { Hono } from "hono";
import { channelDoName, userDoName } from "protocol";
import { getDb } from "../db/client.ts";
import { getUploadSession } from "../db/repos/uploads.ts";

export const internalRoutes = new Hono<{ Bindings: Env }>();

internalRoutes.post("/internal/thumbnail", async (c) => {
  if (c.req.header("x-internal-token") !== c.env.INTERNAL_TOKEN_KEY) {
    return c.json({ error: "forbidden" }, 403);
  }
  const body = (await c.req.json()) as { channelId: string; uploadId: string; thumbKey: string };
  const db = getDb(c.env.DB);
  const session = await getUploadSession(db, body.uploadId);
  if (!session || session.fileOffset !== session.fileSize)
    return c.json({ error: "not found" }, 404);
  const id = c.env.CHANNEL_DO.idFromName(channelDoName(body.channelId));
  await c.env.CHANNEL_DO.get(id).updateThumbByUpload({
    uploadId: body.uploadId,
    thumbUrl: `/files/${body.channelId}/${body.uploadId}?thumb=1`,
    thumbKey: body.thumbKey,
  });
  return c.json({ ok: true });
});

internalRoutes.get("/internal/push-user/:userId/subscriptions", async (c) => {
  if (c.req.header("x-internal-token") !== c.env.INTERNAL_TOKEN_KEY) {
    return c.json({ error: "forbidden" }, 403);
  }
  const id = c.env.USER_DO.idFromName(userDoName(c.req.param("userId")));
  const res = await c.env.USER_DO.get(id).listPushSubscriptions();
  return c.json(res);
});

internalRoutes.delete("/internal/push-user/:userId/subscriptions", async (c) => {
  if (c.req.header("x-internal-token") !== c.env.INTERNAL_TOKEN_KEY) {
    return c.json({ error: "forbidden" }, 403);
  }
  const body = (await c.req.json()) as { deviceId: string };
  const id = c.env.USER_DO.idFromName(userDoName(c.req.param("userId")));
  await c.env.USER_DO.get(id).pushUnsubscribe({ deviceId: body.deviceId });
  return c.json({ ok: true });
});
