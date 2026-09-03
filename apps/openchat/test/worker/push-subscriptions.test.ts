import { expect, test, beforeAll } from "vite-plus/test";
import { exports } from "cloudflare:workers";

let cookie = "";

beforeAll(async () => {
  const signup = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "push@test.dev",
      password: "push-test-password",
      name: "Push",
    }),
  });
  cookie = signup.headers.get("set-cookie") ?? "";
});

async function subscribe(body: Record<string, unknown>) {
  return exports.default.fetch("http://localhost/api/v1/users/me/push_subscriptions", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("register, list, and delete push subscription", async () => {
  const reg = await subscribe({
    deviceId: "d1",
    kind: "webpush",
    endpoint: "https://push.example/ep1",
    p256dh: "pk",
    auth: "au",
  });
  expect(reg.status).toBe(200);

  const list = await exports.default.fetch("http://localhost/api/v1/users/me/push_subscriptions", {
    headers: { cookie },
  });
  expect(list.status).toBe(200);
  const body = (await list.json()) as {
    subscriptions: {
      deviceId: string;
      kind: string;
      endpoint: string;
      p256dh: string | null;
      auth: string | null;
      updatedAt: number;
    }[];
  };
  expect(body.subscriptions).toHaveLength(1);
  expect(body.subscriptions[0]).toMatchObject({
    deviceId: "d1",
    kind: "webpush",
    endpoint: "https://push.example/ep1",
    p256dh: "pk",
    auth: "au",
  });

  const del = await exports.default.fetch(
    "http://localhost/api/v1/users/me/push_subscriptions/d1",
    {
      method: "DELETE",
      headers: { cookie },
    },
  );
  expect(del.status).toBe(200);

  const after = await exports.default.fetch("http://localhost/api/v1/users/me/push_subscriptions", {
    headers: { cookie },
  });
  const afterBody = (await after.json()) as { subscriptions: unknown[] };
  expect(afterBody.subscriptions).toHaveLength(0);
});

test("upsert same deviceId updates endpoint and keeps one row", async () => {
  await subscribe({
    deviceId: "d2",
    kind: "webpush",
    endpoint: "https://push.example/ep2",
    p256dh: "pk2",
    auth: "au2",
  });
  const reg2 = await subscribe({
    deviceId: "d2",
    kind: "webpush",
    endpoint: "https://push.example/ep2-new",
    p256dh: "pk2-new",
    auth: "au2-new",
  });
  expect(reg2.status).toBe(200);

  const list = await exports.default.fetch("http://localhost/api/v1/users/me/push_subscriptions", {
    headers: { cookie },
  });
  const body = (await list.json()) as {
    subscriptions: { deviceId: string; endpoint: string; p256dh: string | null }[];
  };
  const d2 = body.subscriptions.filter((s) => s.deviceId === "d2");
  expect(d2).toHaveLength(1);
  expect(d2[0]).toMatchObject({
    endpoint: "https://push.example/ep2-new",
    p256dh: "pk2-new",
  });
});

test("requires session", async () => {
  const post = await exports.default.fetch("http://localhost/api/v1/users/me/push_subscriptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: "d3", kind: "webpush", endpoint: "https://push.example/ep3" }),
  });
  expect(post.status).toBe(401);

  const get = await exports.default.fetch("http://localhost/api/v1/users/me/push_subscriptions");
  expect(get.status).toBe(401);

  const del = await exports.default.fetch(
    "http://localhost/api/v1/users/me/push_subscriptions/d3",
    {
      method: "DELETE",
    },
  );
  expect(del.status).toBe(401);
});

test("exposes vapid public key", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/users/me/vapid_public_key", {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { publicKey: string };
  expect(body.publicKey).toBe("local-vapid-public-key");
});
