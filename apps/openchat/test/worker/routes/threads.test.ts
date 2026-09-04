import { expect, test, beforeAll } from "vite-plus/test";
import { exports } from "cloudflare:workers";

let owner = "";
let member = "";
let outsider = "";
let teamId = "";
let channelId = "";
let memberUserId = "";
let rootId = "";

async function signup(email: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "threads-test-password",
      name: email.split("@")[0],
      username: email.split("@")[0],
    }),
  });
  return res.headers.get("set-cookie") ?? "";
}

beforeAll(async () => {
  owner = await signup("threads-owner@test.dev");
  member = await signup("threads-member@test.dev");
  outsider = await signup("threads-outsider@test.dev");
  const team = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie: owner, "content-type": "application/json" },
    body: JSON.stringify({ name: "threadsco", displayName: "ThreadsCo", type: "open" }),
  });
  teamId = ((await team.json()) as { id: string }).id;
  const create = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie: owner, "content-type": "application/json" },
    body: JSON.stringify({
      teamId,
      name: "threads",
      displayName: "Threads",
      type: "public",
    }),
  });
  channelId = ((await create.json()) as { id: string }).id;
  await exports.default.fetch(`http://localhost/api/v1/teams/${teamId}/members`, {
    method: "POST",
    headers: { cookie: member, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/members`, {
    method: "POST",
    headers: { cookie: member },
  });
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie: member },
  });
  memberUserId = ((await me.json()) as { user: { id: string } }).user.id;
  const root = await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/posts`, {
    method: "POST",
    headers: { cookie: member, "content-type": "application/json" },
    body: JSON.stringify({ message: "root post", clientToken: "threads-root-1" }),
  });
  rootId = ((await root.json()) as { id: string }).id;
  const reply = await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/posts`, {
    method: "POST",
    headers: { cookie: member, "content-type": "application/json" },
    body: JSON.stringify({
      message: "a reply",
      parentId: rootId,
      clientToken: "threads-reply-1",
    }),
  });
  expect(reply.status).toBe(201);
});

test("thread summary returns replyCount and participants", async () => {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/posts/${rootId}/thread?channelId=${channelId}`,
    { headers: { cookie: member } },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    thread: { postId: string; replyCount: number; participants: string[] };
  };
  expect(body.thread.postId).toBe(rootId);
  expect(body.thread.replyCount).toBe(1);
  expect(body.thread.participants).toContain(memberUserId);
});

test("team threads for user includes the thread with channelId", async () => {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/users/me/teams/${teamId}/threads`,
    { headers: { cookie: member } },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    threads: { postId: string; channelId: string; participants: string[] }[];
  };
  const hit = body.threads.find((t) => t.postId === rootId);
  expect(hit).toBeDefined();
  expect(hit!.channelId).toBe(channelId);
  expect(hit!.participants).toContain(memberUserId);
});

test("thread read and follow endpoints return ok", async () => {
  const read = await exports.default.fetch(`http://localhost/api/v1/posts/${rootId}/thread/read`, {
    method: "POST",
    headers: { cookie: member, "content-type": "application/json" },
    body: JSON.stringify({ channelId }),
  });
  expect(read.status).toBe(200);
  const follow = await exports.default.fetch(`http://localhost/api/v1/posts/${rootId}/following`, {
    method: "POST",
    headers: { cookie: member, "content-type": "application/json" },
    body: JSON.stringify({ channelId, state: true }),
  });
  expect(follow.status).toBe(200);
  const unfollow = await exports.default.fetch(
    `http://localhost/api/v1/posts/${rootId}/following`,
    {
      method: "POST",
      headers: { cookie: member, "content-type": "application/json" },
      body: JSON.stringify({ channelId, state: false }),
    },
  );
  expect(unfollow.status).toBe(200);
});

test("missing thread returns 404", async () => {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/posts/does-not-exist/thread?channelId=${channelId}`,
    { headers: { cookie: member } },
  );
  expect(res.status).toBe(404);
});

test("non-member thread access returns 403", async () => {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/posts/${rootId}/thread?channelId=${channelId}`,
    { headers: { cookie: outsider } },
  );
  expect(res.status).toBe(403);
});
