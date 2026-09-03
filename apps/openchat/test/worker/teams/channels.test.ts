import { expect, test, beforeAll } from "vite-plus/test";
import { exports } from "cloudflare:workers";

let owner = "";
let member = "";
let teamId = "";

async function signup(email: string, password: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name: email.split("@")[0] }),
  });
  return res.headers.get("set-cookie") ?? "";
}

async function userIdOf(cookie: string): Promise<string> {
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie },
  });
  return ((await me.json()) as { user: { id: string } }).user.id;
}

beforeAll(async () => {
  owner = await signup("ch-owner@test.dev", "channel-test-password");
  member = await signup("ch-member@test.dev", "channel-test-password");
  const team = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie: owner, "content-type": "application/json" },
    body: JSON.stringify({ name: "chanco", displayName: "ChanCo", type: "open" }),
  });
  teamId = ((await team.json()) as { id: string }).id;
  await exports.default.fetch(`http://localhost/api/v1/teams/${teamId}/members`, {
    method: "POST",
    headers: { cookie: member, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
});

test("create public channel and member joins", async () => {
  const create = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie: owner, "content-type": "application/json" },
    body: JSON.stringify({
      teamId,
      name: "general",
      displayName: "General",
      type: "public",
    }),
  });
  expect(create.status).toBe(201);
  const channelId = ((await create.json()) as { id: string }).id;

  const join = await exports.default.fetch(
    `http://localhost/api/v1/channels/${channelId}/members`,
    {
      method: "POST",
      headers: { cookie: member },
    },
  );
  expect(join.status).toBe(200);

  const detail = await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}`, {
    headers: { cookie: member },
  });
  expect(detail.status).toBe(200);
  const body = (await detail.json()) as { channel: { memberCount: number } };
  expect(body.channel.memberCount).toBe(2);
});

test("duplicate channel name conflicts", async () => {
  const dup = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie: owner, "content-type": "application/json" },
    body: JSON.stringify({
      teamId,
      name: "general",
      displayName: "General 2",
      type: "public",
    }),
  });
  expect(dup.status).toBe(409);
});

test("non-member cannot read channel", async () => {
  const outsider = await signup("ch-outsider@test.dev", "channel-test-password");
  const list = await exports.default.fetch(`http://localhost/api/v1/teams/${teamId}/channels`, {
    headers: { cookie: owner },
  });
  const channelId = ((await list.json()) as { channels: { id: string }[] }).channels[0].id;
  const detail = await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}`, {
    headers: { cookie: outsider },
  });
  expect(detail.status).toBe(403);
});

test("private channel cannot be joined by non-member", async () => {
  const create = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie: owner, "content-type": "application/json" },
    body: JSON.stringify({
      teamId,
      name: "secret",
      displayName: "Secret",
      type: "private",
    }),
  });
  expect(create.status).toBe(201);
  const channelId = ((await create.json()) as { id: string }).id;

  const join = await exports.default.fetch(
    `http://localhost/api/v1/channels/${channelId}/members`,
    {
      method: "POST",
      headers: { cookie: member },
    },
  );
  expect(join.status).toBe(403);
});

let a = "";
let b = "";
let aId = "";
let bId = "";

beforeAll(async () => {
  a = await signup("dm-a@test.dev", "dm-test-password");
  b = await signup("dm-b@test.dev", "dm-test-password");
  aId = await userIdOf(a);
  bId = await userIdOf(b);
});

test("dm is idempotent", async () => {
  const first = await exports.default.fetch("http://localhost/api/v1/channels/direct", {
    method: "POST",
    headers: { cookie: a, "content-type": "application/json" },
    body: JSON.stringify({ userIds: [aId, bId] }),
  });
  expect(first.status).toBe(201);
  const firstBody = (await first.json()) as { id: string };

  const second = await exports.default.fetch("http://localhost/api/v1/channels/direct", {
    method: "POST",
    headers: { cookie: a, "content-type": "application/json" },
    body: JSON.stringify({ userIds: [bId, aId] }),
  });
  expect(second.status).toBe(200);
  const secondBody = (await second.json()) as { id: string; existing: boolean };
  expect(secondBody.id).toBe(firstBody.id);
  expect(secondBody.existing).toBe(true);
});

test("dm rejects a pair that does not include the caller", async () => {
  const c = await signup("dm-e@test.dev", "dm-test-password");
  const d = await signup("dm-f@test.dev", "dm-test-password");
  const cId = await userIdOf(c);
  const dId = await userIdOf(d);

  const res = await exports.default.fetch("http://localhost/api/v1/channels/direct", {
    method: "POST",
    headers: { cookie: a, "content-type": "application/json" },
    body: JSON.stringify({ userIds: [cId, dId] }),
  });
  expect(res.status).toBe(422);
});

test("gm is idempotent and order-insensitive", async () => {
  const c = await signup("dm-c@test.dev", "dm-test-password");
  const d = await signup("dm-d@test.dev", "dm-test-password");
  const cId = await userIdOf(c);
  const dId = await userIdOf(d);

  const first = await exports.default.fetch("http://localhost/api/v1/channels/group", {
    method: "POST",
    headers: { cookie: a, "content-type": "application/json" },
    body: JSON.stringify({ userIds: [aId, bId, cId, dId] }),
  });
  expect(first.status).toBe(201);
  const firstBody = (await first.json()) as { id: string };

  const second = await exports.default.fetch("http://localhost/api/v1/channels/group", {
    method: "POST",
    headers: { cookie: a, "content-type": "application/json" },
    body: JSON.stringify({ userIds: [dId, cId, bId, aId] }),
  });
  expect(second.status).toBe(200);
  const secondBody = (await second.json()) as { id: string; existing: boolean };
  expect(secondBody.id).toBe(firstBody.id);
  expect(secondBody.existing).toBe(true);
});
