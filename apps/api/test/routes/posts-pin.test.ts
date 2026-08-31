import { expect, test, beforeAll } from "vite-plus/test";
import { exports } from "cloudflare:workers";

let userA = "";
let userB = "";
let channelId = "";
let messageId = "";

async function signup(email: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "posts-pin-password",
      name: email.split("@")[0],
    }),
  });
  return res.headers.get("set-cookie") ?? "";
}

beforeAll(async () => {
  userA = await signup("pin-a@test.dev");
  userB = await signup("pin-b@test.dev");
  const team = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie: userA, "content-type": "application/json" },
    body: JSON.stringify({ name: "pinco", displayName: "PinCo", type: "open" }),
  });
  const teamId = ((await team.json()) as { id: string }).id;
  const create = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie: userA, "content-type": "application/json" },
    body: JSON.stringify({ teamId, name: "pin", displayName: "Pin", type: "public" }),
  });
  channelId = ((await create.json()) as { id: string }).id;
  await exports.default.fetch(`http://localhost/api/v1/teams/${teamId}/members`, {
    method: "POST",
    headers: { cookie: userB, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  const join = await exports.default.fetch(
    `http://localhost/api/v1/channels/${channelId}/members`,
    {
      method: "POST",
      headers: { cookie: userB },
    },
  );
  expect(join.status).toBe(200);
  const post = await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/posts`, {
    method: "POST",
    headers: { cookie: userA, "content-type": "application/json" },
    body: JSON.stringify({ message: "pinnable" }),
  });
  expect(post.status).toBe(201);
  messageId = ((await post.json()) as { id: string }).id;
});

test("non-author non-admin pin returns 403", async () => {
  const res = await exports.default.fetch(`http://localhost/api/v1/posts/${messageId}/pin`, {
    method: "POST",
    headers: { cookie: userB, "content-type": "application/json" },
    body: JSON.stringify({ channelId }),
  });
  expect(res.status).toBe(403);
  const body = (await res.json()) as { code: string };
  expect(body.code).toBe("forbidden");
});

test("author pin returns ok and history shows isPinned true", async () => {
  const res = await exports.default.fetch(`http://localhost/api/v1/posts/${messageId}/pin`, {
    method: "POST",
    headers: { cookie: userA, "content-type": "application/json" },
    body: JSON.stringify({ channelId }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });

  const hist = await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/posts`, {
    headers: { cookie: userA },
  });
  expect(hist.status).toBe(200);
  const body = (await hist.json()) as { messages: Record<string, unknown>[] };
  const target = body.messages.find((m) => m.id === messageId)!;
  expect(target.isPinned).toBe(true);
});

test("author unpin returns ok", async () => {
  const res = await exports.default.fetch(`http://localhost/api/v1/posts/${messageId}/unpin`, {
    method: "POST",
    headers: { cookie: userA, "content-type": "application/json" },
    body: JSON.stringify({ channelId }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
