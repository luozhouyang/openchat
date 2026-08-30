import { Hono } from "hono";
import { userDoName } from "protocol";
import { requireSession } from "../auth/session.ts";

export const pushRoutes = new Hono<{ Bindings: Env }>();

async function userDoStub(env: Env, userId: string) {
  return env.USER_DO.get(env.USER_DO.idFromName(userDoName(userId)));
}

pushRoutes.post("/me/push-subscriptions", requireSession, async (c) => {
  const userId = c.get("session")!.user.id;
  const body = await c.req.json();
  const res = await (await userDoStub(c.env, userId)).pushSubscribe(body);
  return res.ok ? c.json({ ok: true }) : c.json({ error: "failed" }, 502);
});

pushRoutes.delete("/me/push-subscriptions/:deviceId", requireSession, async (c) => {
  const userId = c.get("session")!.user.id;
  const res = await (
    await userDoStub(c.env, userId)
  ).pushUnsubscribe({ deviceId: c.req.param("deviceId") });
  return res.ok ? c.json({ ok: true }) : c.json({ error: "failed" }, 502);
});

pushRoutes.get("/me/push-subscriptions", requireSession, async (c) => {
  const userId = c.get("session")!.user.id;
  const res = await (await userDoStub(c.env, userId)).listPushSubscriptions();
  return c.json(res);
});

pushRoutes.get("/me/vapid-public-key", (c) => c.json({ publicKey: c.env.VAPID_PUBLIC_KEY }));
