import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { channelDoName } from "protocol";

let owner = "";
let member = "";
let outsider = "";
let teamId = "";
let channelId = "";
let ownerUserId = "";

async function signup(email: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "history-http-password", name: email.split("@")[0] }),
  });
  return res.headers.get("set-cookie") ?? "";
}

beforeAll(async () => {
  owner = await signup("hist-owner@test.dev");
  member = await signup("hist-member@test.dev");
  outsider = await signup("hist-outsider@test.dev");
  const team = await exports.default.fetch("http://localhost/teams", {
    method: "POST",
    headers: { cookie: owner, "content-type": "application/json" },
    body: JSON.stringify({ name: "histco", displayName: "HistCo", type: "open" }),
  });
  teamId = ((await team.json()) as { id: string }).id;
  const create = await exports.default.fetch(`http://localhost/teams/${teamId}/channels`, {
    method: "POST",
    headers: { cookie: owner, "content-type": "application/json" },
    body: JSON.stringify({ name: "hist", displayName: "Hist", type: "public" }),
  });
  channelId = ((await create.json()) as { id: string }).id;
  await exports.default.fetch(`http://localhost/teams/${teamId}/join`, {
    method: "POST",
    headers: { cookie: member, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  await exports.default.fetch(`http://localhost/channels/${channelId}/join`, {
    method: "POST",
    headers: { cookie: member },
  });
  const me = await exports.default.fetch("http://localhost/me", { headers: { cookie: owner } });
  ownerUserId = ((await me.json()) as { user: { id: string } }).user.id;
  const stub = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
  await stub.membersAdd({ userId: ownerUserId, role: "member" });
});

test("history returns messages for a member", async () => {
  const stub = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
  await stub.postMessage(ownerUserId, { content: "h-1", clientToken: "h-1" });
  await stub.postMessage(ownerUserId, { content: "h-2", clientToken: "h-2" });

  const res = await exports.default.fetch(
    `http://localhost/channels/${channelId}/history?limit=10`,
    { headers: { cookie: member } },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    messages: { content: string; seq: number }[];
    oldestSeq: number | null;
  };
  expect(body.messages.map((m) => m.content)).toEqual(["h-2", "h-1"]);
  expect(body.oldestSeq).toBe(body.messages[body.messages.length - 1].seq);
});

test("history before_seq paginates without overlap", async () => {
  const page1 = await exports.default.fetch(
    `http://localhost/channels/${channelId}/history?limit=1`,
    { headers: { cookie: member } },
  );
  const p1 = (await page1.json()) as { messages: { content: string }[]; oldestSeq: number | null };
  const page2 = await exports.default.fetch(
    `http://localhost/channels/${channelId}/history?limit=10&before_seq=${p1.oldestSeq}`,
    { headers: { cookie: member } },
  );
  const p2 = (await page2.json()) as { messages: { content: string }[] };
  expect(p1.messages.map((m) => m.content)).toEqual(["h-2"]);
  expect(p2.messages.map((m) => m.content)).toEqual(["h-1"]);
});

test("non-member gets 403 from history", async () => {
  const res = await exports.default.fetch(
    `http://localhost/channels/${channelId}/history?limit=10`,
    { headers: { cookie: outsider } },
  );
  expect(res.status).toBe(403);
});
