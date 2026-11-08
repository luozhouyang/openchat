import { exports } from "cloudflare:workers";
import { beforeAll, expect, test } from "vite-plus/test";

let memberCookie = "";
let outsiderCookie = "";
let teamId = "";
let firstChannelId = "";
let secondChannelId = "";

async function signup(email: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "global-search-password",
      name: email.split("@")[0],
      username: email.split("@")[0],
    }),
  });
  return res.headers.get("set-cookie") ?? "";
}

async function createChannel(name: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie: memberCookie, "content-type": "application/json" },
    body: JSON.stringify({ teamId, name, displayName: name, type: "public" }),
  });
  return ((await res.json()) as { id: string }).id;
}

async function post(channelId: string, message: string) {
  const res = await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/posts`, {
    method: "POST",
    headers: { cookie: memberCookie, "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  expect(res.status).toBe(201);
}

async function search(cookie: string, q: string) {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/search?q=${encodeURIComponent(q)}`,
    { headers: { cookie } },
  );
  return {
    status: res.status,
    body: (await res.json()) as {
      hits: Array<{ message: { content: string }; channel: { id: string; displayName: string } }>;
    },
  };
}

beforeAll(async () => {
  memberCookie = await signup("gsearch-member@test.dev");
  outsiderCookie = await signup("gsearch-outsider@test.dev");
  const team = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie: memberCookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "gsearchco", displayName: "GSearchCo", type: "open" }),
  });
  teamId = ((await team.json()) as { id: string }).id;
  firstChannelId = await createChannel("alpha");
  secondChannelId = await createChannel("beta");
  await post(firstChannelId, "deploy is ready");
  await post(secondChannelId, "deploy notes updated");
  await post(secondChannelId, "unrelated");
});

test("searches every channel the caller belongs to", async () => {
  const { status, body } = await search(memberCookie, "deploy");
  expect(status).toBe(200);
  expect(body.hits).toHaveLength(2);
  const channels = body.hits.map((hit) => hit.channel.id).sort();
  expect(channels).toEqual([firstChannelId, secondChannelId].sort());
  expect(body.hits[0]?.channel.displayName).toBeTruthy();
});

test("non-members see no hits", async () => {
  const { status, body } = await search(outsiderCookie, "deploy");
  expect(status).toBe(200);
  expect(body.hits).toHaveLength(0);
});

test("empty queries are rejected", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/search?q=", {
    headers: { cookie: memberCookie },
  });
  expect(res.status).toBe(422);
});
