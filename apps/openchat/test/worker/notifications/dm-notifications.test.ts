import { exports } from "cloudflare:workers";
import { beforeAll, expect, test } from "vite-plus/test";
import { signup, userIdOf } from "../helpers/setup.ts";

let aliceCookie = "";
let bobCookie = "";
let aliceId = "";
let bobId = "";
let channelId = "";

async function post(cookie: string, message: string): Promise<string> {
  const res = await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/posts`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ message, clientToken: crypto.randomUUID() }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function inbox(cookie: string): Promise<Array<{ messageId: string; kind: string }>> {
  const res = await exports.default.fetch("http://localhost/api/v1/users/me/notifications", {
    headers: { cookie },
  });
  const body = (await res.json()) as {
    notifications: Array<{ messageId: string; kind: string }>;
  };
  return body.notifications;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("condition not met in time");
}

beforeAll(async () => {
  aliceCookie = await signup(exports.default, "dm-notif-a@test.dev", "test-password", "Alice");
  bobCookie = await signup(exports.default, "dm-notif-b@test.dev", "test-password", "Bob");
  aliceId = await userIdOf(exports.default, aliceCookie);
  bobId = await userIdOf(exports.default, bobCookie);
  const res = await exports.default.fetch("http://localhost/api/v1/channels/direct", {
    method: "POST",
    headers: { cookie: aliceCookie, "content-type": "application/json" },
    body: JSON.stringify({ userIds: [aliceId, bobId] }),
  });
  expect([200, 201]).toContain(res.status);
  channelId = ((await res.json()) as { id: string }).id;
});

test("a direct message lands in the recipient inbox as a dm notification", async () => {
  const messageId = await post(aliceCookie, "hi bob");
  await waitFor(async () =>
    (await inbox(bobCookie)).some((item) => item.messageId === messageId && item.kind === "dm"),
  );
  expect((await inbox(aliceCookie)).some((item) => item.messageId === messageId)).toBe(false);
});

test("a mention in a dm still wins over the dm kind", async () => {
  const messageId = await post(aliceCookie, `hey @[${bobId}] ping`);
  await waitFor(async () =>
    (await inbox(bobCookie)).some(
      (item) => item.messageId === messageId && item.kind === "mention",
    ),
  );
});
