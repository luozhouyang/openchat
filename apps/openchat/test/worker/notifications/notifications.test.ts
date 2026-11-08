import { exports } from "cloudflare:workers";
import { beforeAll, expect, test } from "vite-plus/test";
import { signup, userIdOf } from "../helpers/setup.ts";

let aliceCookie = "";
let aliceId = "";
let bobCookie = "";
let bobId = "";
let channelId = "";
let teamId = "";

async function list(cookie: string) {
  const res = await exports.default.fetch("http://localhost/api/v1/users/me/notifications", {
    headers: { cookie },
  });
  return {
    status: res.status,
    body: (await res.json()) as {
      notifications: Array<{ kind: string; messageId: string; readAt: number | null }>;
      unread: number;
    },
  };
}

async function markRead(cookie: string, ids?: string[]) {
  const res = await exports.default.fetch("http://localhost/api/v1/users/me/notifications/read", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(ids ? { ids } : {}),
  });
  expect(res.status).toBe(200);
}

async function post(cookie: string, message: string, parentId?: string) {
  const res = await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/posts`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ message, ...(parentId ? { parentId } : {}) }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

beforeAll(async () => {
  aliceCookie = await signup(exports.default, "notif-alice@test.dev", "test-password", "Alice");
  aliceId = await userIdOf(exports.default, aliceCookie);
  bobCookie = await signup(exports.default, "notif-bob@test.dev", "test-password", "Bob");
  bobId = await userIdOf(exports.default, bobCookie);

  const team = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie: aliceCookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "notifco", displayName: "NotifCo", type: "open" }),
  });
  teamId = ((await team.json()) as { id: string }).id;
  const channel = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie: aliceCookie, "content-type": "application/json" },
    body: JSON.stringify({ teamId, name: "notif", displayName: "Notif", type: "public" }),
  });
  channelId = ((await channel.json()) as { id: string }).id;
  await exports.default.fetch(`http://localhost/api/v1/teams/${teamId}/members`, {
    method: "POST",
    headers: { cookie: bobCookie, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/members`, {
    method: "POST",
    headers: { cookie: bobCookie },
  });
});

test("mentions create an unread inbox entry for the target", async () => {
  const message = await post(aliceCookie, `hey @[${bobId}] look`);
  const { status, body } = await list(bobCookie);
  expect(status).toBe(200);
  const entry = body.notifications.find((item) => item.messageId === message.id);
  expect(entry?.kind).toBe("mention");
  expect(entry?.readAt).toBeNull();
  expect(body.unread).toBeGreaterThanOrEqual(1);
});

test("marking read clears the unread counter", async () => {
  await markRead(bobCookie);
  const { body } = await list(bobCookie);
  expect(body.unread).toBe(0);
  expect(body.notifications.every((item) => item.readAt !== null)).toBe(true);
});

test("thread replies notify the parent author", async () => {
  const parent = await post(aliceCookie, "thread parent");
  await post(bobCookie, "a reply", parent.id);
  const { body } = await list(aliceCookie);
  const entry = body.notifications.find(
    (item) => item.kind === "reply" && item.messageId !== parent.id,
  );
  expect(entry).toBeTruthy();
});

test("self mentions do not notify the sender", async () => {
  const before = await list(aliceCookie);
  await post(aliceCookie, `note to self @[${aliceId}]`);
  const after = await list(aliceCookie);
  expect(after.body.unread).toBe(before.body.unread);
});
