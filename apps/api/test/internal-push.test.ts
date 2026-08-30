import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";

let cookie = "";
let userId = "";

beforeAll(async () => {
  const signup = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "internal-push@test.dev",
      password: "internal-push-password",
      name: "IP",
    }),
  });
  cookie = signup.headers.get("set-cookie") ?? "";
  const tokenRes = await exports.default.fetch("http://localhost/api/auth/token", {
    headers: { cookie },
  });
  const { token } = (await tokenRes.json()) as { token: string };
  const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as {
    sub: string;
  };
  userId = payload.sub;
});

async function registerSubscription() {
  return exports.default.fetch("http://localhost/me/push-subscriptions", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      deviceId: "ip1",
      kind: "webpush",
      endpoint: "https://push.example/ip1",
      p256dh: "pk",
      auth: "au",
    }),
  });
}

function internalGet(token?: string) {
  return exports.default.fetch(`http://localhost/internal/push-user/${userId}/subscriptions`, {
    headers: token ? { "x-internal-token": token } : {},
  });
}

test("internal subscriptions endpoint requires token", async () => {
  await registerSubscription();
  const res = await internalGet();
  expect(res.status).toBe(403);
});

test("internal subscriptions list and delete via token", async () => {
  await registerSubscription();

  const list = await internalGet(env.INTERNAL_TOKEN_KEY);
  expect(list.status).toBe(200);
  const body = (await list.json()) as {
    subscriptions: { deviceId: string; kind: string; endpoint: string }[];
  };
  expect(body.subscriptions).toContainEqual(
    expect.objectContaining({
      deviceId: "ip1",
      kind: "webpush",
      endpoint: "https://push.example/ip1",
    }),
  );

  const del = await exports.default.fetch(
    `http://localhost/internal/push-user/${userId}/subscriptions`,
    {
      method: "DELETE",
      headers: {
        "x-internal-token": env.INTERNAL_TOKEN_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ deviceId: "ip1" }),
    },
  );
  expect(del.status).toBe(200);
  expect(await del.json()).toEqual({ ok: true });

  const after = await internalGet(env.INTERNAL_TOKEN_KEY);
  const afterBody = (await after.json()) as { subscriptions: { deviceId: string }[] };
  expect(afterBody.subscriptions).not.toContainEqual(expect.objectContaining({ deviceId: "ip1" }));
});

test("internal delete requires token", async () => {
  const res = await exports.default.fetch(
    `http://localhost/internal/push-user/${userId}/subscriptions`,
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: "ip1" }),
    },
  );
  expect(res.status).toBe(403);
});
