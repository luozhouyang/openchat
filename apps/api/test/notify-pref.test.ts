import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { channelDoName, issueInternalToken, userDoName } from "protocol";

let owner = "";
let outsider = "";
let ownerId = "";
let teamId = "";
let channelId = "";

async function signup(email: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "notify-test-password",
      name: email.split("@")[0],
    }),
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
  owner = await signup("np-owner@test.dev");
  outsider = await signup("np-outsider@test.dev");
  ownerId = await userIdOf(owner);
  const team = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie: owner, "content-type": "application/json" },
    body: JSON.stringify({ name: "np", display_name: "NP", type: "open" }),
  });
  teamId = ((await team.json()) as { id: string }).id;
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
  channelId = ((await create.json()) as { id: string }).id;
});

async function setPref(cookie: string, userId: string, pref: string) {
  return exports.default.fetch(
    `http://localhost/api/v1/channels/${channelId}/members/${userId}/notify_props`,
    {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ notify_props: { pref } }),
    },
  );
}

function nextMessage(ws: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (event) => resolve(event as MessageEvent), { once: true });
  });
}

test("set notify pref returns ok", async () => {
  const res = await setPref(owner, ownerId, "mention");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean };
  expect(body.ok).toBe(true);
});

test("invalid pref returns 422", async () => {
  const res = await setPref(owner, ownerId, "bogus");
  expect(res.status).toBe(422);
});

test("non-member cannot set notify pref", async () => {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/channels/${channelId}/members/${ownerId}/notify_props`,
    {
      method: "PUT",
      headers: { cookie: outsider, "content-type": "application/json" },
      body: JSON.stringify({ notify_props: { pref: "all" } }),
    },
  );
  expect(res.status).toBe(403);
});

test("requires session", async () => {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/channels/${channelId}/members/${ownerId}/notify_props`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notify_props: { pref: "all" } }),
    },
  );
  expect(res.status).toBe(401);
});

test("setNotifPref RPC is idempotent and rejects non-members", async () => {
  const id = env.CHANNEL_DO.idFromName(channelDoName("c-pref-rpc"));
  const stub = env.CHANNEL_DO.get(id);
  await stub.membersAdd({ userId: "alice", role: "member" });

  expect(await stub.setNotifPref({ userId: "alice", pref: "mention" })).toEqual({ ok: true });
  expect(await stub.setNotifPref({ userId: "alice", pref: "mention" })).toEqual({ ok: true });
  expect(await stub.setNotifPref({ userId: "alice", pref: "all" })).toEqual({ ok: true });
  expect(
    await stub.setNotifPref({ userId: "alice", pref: "bogus" as "all" | "mention" | "none" }),
  ).toEqual({
    error: "invalid",
    status: 422,
  });
  expect(await stub.setNotifPref({ userId: "ghost", pref: "all" })).toEqual({
    error: "not a member",
    status: 403,
  });
});

test("message broadcast delivers notifPref to subscriber user DO without leaking it", async () => {
  const id = env.CHANNEL_DO.idFromName(channelDoName("c-pref-broadcast"));
  const stub = env.CHANNEL_DO.get(id);
  await stub.membersAdd({ userId: "alice", role: "member" });
  await stub.membersAdd({ userId: "bob", role: "member" });
  await stub.subscribe({ userId: "alice" });
  await stub.subscribe({ userId: "bob" });

  await stub.setNotifPref({ userId: "alice", pref: "mention" });

  const bobDo = env.USER_DO.get(env.USER_DO.idFromName(userDoName("bob")));
  const token = await issueInternalToken({ subject: "user:bob", secret: env.INTERNAL_TOKEN_KEY });
  const up = await bobDo.fetch(
    new Request("http://user-do/ws?deviceId=d1", {
      headers: { Upgrade: "websocket", "x-internal-token": token },
    }),
  );
  expect(up.status).toBe(101);
  const ws = up.webSocket!;
  ws.accept();
  const hello = await nextMessage(ws);
  expect(JSON.parse(String(hello.data))).toMatchObject({ type: "hello" });

  const pushed = nextMessage(ws);
  const post = await stub.postMessage("alice", { content: "hello @[bob]", clientToken: "pf-1" });
  expect(post).not.toHaveProperty("error");
  const event = await pushed;
  const body = JSON.parse(String(event.data));
  expect(body.type).toBe("channel.event");
  expect(body).not.toHaveProperty("notifPref");

  ws.close(1000, "done");
});
