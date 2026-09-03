import { Hono } from "hono";
import { userDoName } from "protocol";
import { PushSubscribeInput } from "protocol";
import { requireSession } from "../../auth/session.ts";
import { apiError } from "../../lib/errors.ts";
import { zodValidator } from "../../lib/validation.ts";

export const pushV1 = new Hono<{ Bindings: Env }>();

async function userDoStub(env: Env, userId: string) {
  return env.USER_DO.get(env.USER_DO.idFromName(userDoName(userId)));
}

pushV1.post(
  "/users/me/push_subscriptions",
  requireSession,
  zodValidator("json", PushSubscribeInput),
  async (c) => {
    const userId = c.get("session")!.user.id;
    const body = c.req.valid("json");
    const res = await (await userDoStub(c.env, userId)).pushSubscribe(body);
    if (!res.ok) throw apiError("failed", "failed", 502);
    return c.json({ ok: true });
  },
);
pushV1.delete("/users/me/push_subscriptions/:deviceId", requireSession, async (c) => {
  const userId = c.get("session")!.user.id;
  const res = await (
    await userDoStub(c.env, userId)
  ).pushUnsubscribe({ deviceId: c.req.param("deviceId") });
  if (!res.ok) throw apiError("failed", "failed", 502);
  return c.json({ ok: true });
});
pushV1.get("/users/me/push_subscriptions", requireSession, async (c) => {
  const userId = c.get("session")!.user.id;
  const res = await (await userDoStub(c.env, userId)).listPushSubscriptions();
  return c.json(res);
});
pushV1.get("/users/me/vapid_public_key", async (c) =>
  c.json({ publicKey: c.env.VAPID_PUBLIC_KEY }),
);
