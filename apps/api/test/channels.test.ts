import { expect, test, beforeAll } from "vite-plus/test";
import { exports } from "cloudflare:workers";

let owner = "";
let member = "";
let teamId = "";

async function signup(email: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "channel-test-password", name: email.split("@")[0] }),
  });
  return res.headers.get("set-cookie") ?? "";
}

beforeAll(async () => {
  owner = await signup("ch-owner@test.dev");
  member = await signup("ch-member@test.dev");
  const team = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie: owner, "content-type": "application/json" },
    body: JSON.stringify({ name: "chanco", display_name: "ChanCo", type: "open" }),
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
      team_id: teamId,
      name: "general",
      display_name: "General",
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
  const body = (await detail.json()) as { memberCount: number };
  expect(body.memberCount).toBe(2);
});

test("duplicate channel name conflicts", async () => {
  const dup = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie: owner, "content-type": "application/json" },
    body: JSON.stringify({
      team_id: teamId,
      name: "general",
      display_name: "General 2",
      type: "public",
    }),
  });
  expect(dup.status).toBe(409);
});

test("non-member cannot read channel", async () => {
  const outsider = await signup("ch-outsider@test.dev");
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
      team_id: teamId,
      name: "secret",
      display_name: "Secret",
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
