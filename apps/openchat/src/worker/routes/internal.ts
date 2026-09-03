import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { channelDoName, userDoName, ThumbnailInput, DeleteSubscriptionInput } from "protocol";
import { getDb } from "../db/client.ts";
import { getUploadSession } from "../db/repos/uploads.ts";
import { apiError } from "../lib/errors.ts";
import { zodValidator } from "../lib/validation.ts";

export const internalRoutes = new Hono<{ Bindings: Env }>();

const requireInternalToken = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (c.req.header("x-internal-token") !== c.env.INTERNAL_TOKEN_KEY)
    throw apiError("forbidden", "forbidden", 403);
  await next();
});

internalRoutes.post(
  "/internal/thumbnail",
  requireInternalToken,
  zodValidator("json", ThumbnailInput),
  async (c) => {
    const body = c.req.valid("json");
    const db = getDb(c.env.DB);
    const session = await getUploadSession(db, body.uploadId);
    if (!session || session.fileOffset !== session.fileSize)
      throw apiError("not found", "not found", 404);
    const id = c.env.CHANNEL_DO.idFromName(channelDoName(body.channelId));
    await c.env.CHANNEL_DO.get(id).updateThumbByUpload({
      uploadId: body.uploadId,
      thumbUrl: `/files/${body.channelId}/${body.uploadId}?thumb=1`,
      thumbKey: body.thumbKey,
    });
    return c.json({ ok: true });
  },
);
internalRoutes.get("/internal/push-user/:userId/subscriptions", requireInternalToken, async (c) => {
  const id = c.env.USER_DO.idFromName(userDoName(c.req.param("userId")));
  const res = await c.env.USER_DO.get(id).listPushSubscriptions();
  return c.json(res);
});
internalRoutes.delete(
  "/internal/push-user/:userId/subscriptions",
  requireInternalToken,
  zodValidator("json", DeleteSubscriptionInput),
  async (c) => {
    const body = c.req.valid("json");
    const id = c.env.USER_DO.idFromName(userDoName(c.req.param("userId")));
    await c.env.USER_DO.get(id).pushUnsubscribe({ deviceId: body.deviceId });
    return c.json({ ok: true });
  },
);
