import { Hono } from "hono";
import { userDoName } from "protocol";
import { requireSession } from "../../auth/session.ts";

export const pushV1 = new Hono<{ Bindings: Env }>();

async function userDoStub(env: Env, userId: string) {
  return env.USER_DO.get(env.USER_DO.idFromName(userDoName(userId)));
}

pushV1.post("/users/me/push_subscriptions", requireSession, async (c) => {
  const userId = c.get("session")!.user.id;
  const body = await c.req.json();
  const res = await (await userDoStub(c.env, userId)).pushSubscribe(body);
  return res.ok ? c.json({ ok: true }) : c.json({ error: "failed" }, 502);
});

pushV1.delete("/users/me/push_subscriptions/:deviceId", requireSession, async (c) => {
  const userId = c.get("session")!.user.id;
  const res = await (
    await userDoStub(c.env, userId)
  ).pushUnsubscribe({ deviceId: c.req.param("deviceId") });
  return res.ok ? c.json({ ok: true }) : c.json({ error: "failed" }, 502);
});

pushV1.get("/users/me/push_subscriptions", requireSession, async (c) => {
  const userId = c.get("session")!.user.id;
  const res = await (await userDoStub(c.env, userId)).listPushSubscriptions();
  return c.json(res);
});

pushV1.get("/users/me/vapid_public_key", (c) => c.json({ publicKey: c.env.VAPID_PUBLIC_KEY }));
