import { exports } from "cloudflare:workers";
import { beforeAll, expect, test } from "vite-plus/test";
import { signup, userIdOf } from "../helpers/setup.ts";

let aliceCookie = "";
let bobCookie = "";
let bobId = "";
let channelId = "";
let messageId = "";

async function post(cookie: string, message: string): Promise<{ id: string }> {
  const res = await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/posts`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ message, clientToken: crypto.randomUUID() }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

async function edit(cookie: string, message: string): Promise<void> {
  const res = await exports.default.fetch(`http://localhost/api/v1/posts/${messageId}/patch`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ channelId, message }),
  });
  expect(res.status).toBe(200);
}

async function history(): Promise<Array<{ id: string; mentions: string[] | null }>> {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/channels/${channelId}/posts?limit=50`,
    { headers: { cookie: aliceCookie } },
  );
  const body = (await res.json()) as {
    messages: Array<{ id: string; mentions: string[] | null }>;
  };
  return body.messages;
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
  aliceCookie = await signup(exports.default, "edit-mentions-a@test.dev", "test-password", "Alice");
  bobCookie = await signup(exports.default, "edit-mentions-b@test.dev", "test-password", "Bob");
  bobId = await userIdOf(exports.default, bobCookie);
  const teamRes = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie: aliceCookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "edit-mentions", displayName: "Edit Mentions", type: "open" }),
  });
  const teamId = ((await teamRes.json()) as { id: string }).id;
  const channelRes = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie: aliceCookie, "content-type": "application/json" },
    body: JSON.stringify({ teamId, name: "edit", displayName: "Edit", type: "public" }),
  });
  channelId = ((await channelRes.json()) as { id: string }).id;
  await exports.default.fetch(`http://localhost/api/v1/teams/${teamId}/members`, {
    method: "POST",
    headers: { cookie: bobCookie, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/members`, {
    method: "POST",
    headers: { cookie: bobCookie },
  });
  messageId = (await post(aliceCookie, "hello there")).id;
});

test("editing a mention into a message notifies the target", async () => {
  expect((await inbox(bobCookie)).some((item) => item.messageId === messageId)).toBe(false);

  await edit(aliceCookie, `hi @[${bobId}] there`);

  await waitFor(async () =>
    (await inbox(bobCookie)).some(
      (item) => item.messageId === messageId && item.kind === "mention",
    ),
  );
  const message = (await history()).find((item) => item.id === messageId);
  expect(message?.mentions).toContain(bobId);
});

test("editing the mention away removes the inbox entry", async () => {
  await edit(aliceCookie, "hello again");

  await waitFor(async () => !(await inbox(bobCookie)).some((item) => item.messageId === messageId));
  const message = (await history()).find((item) => item.id === messageId);
  expect(message?.mentions ?? []).not.toContain(bobId);
});
