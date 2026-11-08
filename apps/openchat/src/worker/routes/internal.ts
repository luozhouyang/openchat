import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import {
  channelDoName,
  userDoName,
  ThumbnailInput,
  DeleteSubscriptionInput,
  verifyInternalToken,
} from "protocol";
import { getDb } from "@worker/db/client";
import { getUploadSession } from "@worker/db/repos/uploads";
import { apiError } from "@worker/lib/errors";
import { zodValidator } from "@worker/lib/validation";

export const internalRoutes = new Hono<{ Bindings: Env }>();

/**
 * Machine-to-machine auth for /internal/*: short-lived HMAC tokens issued via
 * `issueInternalToken` from packages/protocol (same scheme the WS upgrade
 * handshake already uses), subjects namespaced `internal:*` ("internal:push"
 * for the push fan-out app, "internal:thumbnail" for the queue consumer).
 * The static-secret compare (raw key in the header) is gone: signature
 * verification is constant-time, the TTL check lives in the token itself,
 * and the subject namespace is compared with the Workers runtime's
 * `timingSafeEqual` (equal-length slices, as required by that API).
 */
const requireInternalToken = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const token = c.req.header("x-internal-token") ?? "";
  const claims = token ? await verifyInternalToken(token, c.env.INTERNAL_TOKEN_KEY) : null;
  if (!claims || !timingSafeEqualCompare(claims.subject.slice(0, 9), "internal:")) {
    throw apiError("forbidden", "forbidden", 403);
  }
  await next();
});

/**
 * Constant-time compare of fixed-length byte slices (the 9-byte `internal:`
 * namespace prefix). Not a secret comparison on its own — the HMAC signature
 * above is the gate — but keeps the subject gate out of mid-request
 * early-exit enumeration.
 */
function timingSafeEqualCompare(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) {
    return false;
  }
  return crypto.subtle.timingSafeEqual(ab, bb);
}

internalRoutes.post(
  "/internal/thumbnail",
  requireInternalToken,
  zodValidator("json", ThumbnailInput),
  async (c) => {
    const body = c.req.valid("json");
    const db = getDb(c.env.DB);
    const session = await getUploadSession(db, body.uploadId);
    if (!session || session.fileOffset !== session.fileSize) {
      throw apiError("not found", "not found", 404);
    }
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
