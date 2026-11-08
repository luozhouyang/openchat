import { exports } from "cloudflare:workers";
import { beforeAll, expect, test } from "vite-plus/test";

let memberCookie = "";
let outsiderCookie = "";
let channelId = "";

async function signup(email: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "search-test-password",
      name: email.split("@")[0],
      username: email.split("@")[0],
    }),
  });
  return res.headers.get("set-cookie") ?? "";
}

async function post(cookie: string, message: string) {
  const res = await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/posts`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  expect(res.status).toBe(201);
}

async function search(cookie: string, q: string) {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/channels/${channelId}/posts/search?q=${encodeURIComponent(q)}`,
    { headers: { cookie } },
  );
  return {
    status: res.status,
    body: (await res.json()) as { messages: Array<{ content: string }> },
  };
}

beforeAll(async () => {
  memberCookie = await signup("search-member@test.dev");
  outsiderCookie = await signup("search-outsider@test.dev");
  const team = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie: memberCookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "searchco", displayName: "SearchCo", type: "open" }),
  });
  const teamId = ((await team.json()) as { id: string }).id;
  const channel = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie: memberCookie, "content-type": "application/json" },
    body: JSON.stringify({ teamId, name: "search", displayName: "Search", type: "public" }),
  });
  channelId = ((await channel.json()) as { id: string }).id;
  await post(memberCookie, "alpha release notes");
  await post(memberCookie, "beta rollout");
  await post(memberCookie, "ALPHA follow-up");
});

test("search matches case-insensitively and newest first", async () => {
  const { status, body } = await search(memberCookie, "alpha");
  expect(status).toBe(200);
  expect(body.messages.map((m) => m.content)).toEqual(["ALPHA follow-up", "alpha release notes"]);
});

test("search treats SQL wildcards literally", async () => {
  const { body } = await search(memberCookie, "%");
  expect(body.messages).toHaveLength(0);
});

test("search rejects an empty query", async () => {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/channels/${channelId}/posts/search?q=`,
    { headers: { cookie: memberCookie } },
  );
  expect(res.status).toBe(422);
});

test("non-members cannot search a channel", async () => {
  const { status } = await search(outsiderCookie, "alpha");
  expect(status).toBe(403);
});
