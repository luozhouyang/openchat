import { env, exports } from "cloudflare:workers";
import { expect, test, beforeAll } from "vite-plus/test";
import { channelDoName, issueInternalToken, userDoName } from "protocol";

async function signup(email: string, password: string): Promise<{ cookie: string; id: string }> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      name: email.split("@")[0],
      username: email.split("@")[0],
    }),
  });
  const cookie = res.headers.get("set-cookie") ?? "";
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie },
  });
  const { user } = (await me.json()) as { user: { id: string } };
  return { cookie, id: user.id };
}

async function createTeam(cookie: string, name: string, displayName: string) {
  const res = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name, displayName, type: "open" }),
  });
  return ((await res.json()) as { id: string }).id;
}

async function createChannel(cookie: string, teamId: string, name: string, displayName: string) {
  const res = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ teamId, name, displayName, type: "public" }),
  });
  return ((await res.json()) as { id: string }).id;
}

function nextMessage(ws: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (event) => resolve(event as MessageEvent), { once: true });
  });
}

let subCookie = "";

beforeAll(async () => {
  subCookie = (await signup("push@test.dev", "push-test-password")).cookie;
});

async function subscribe(cookie: string, body: Record<string, unknown>) {
  return exports.default.fetch("http://localhost/api/v1/users/me/push_subscriptions", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("register, list, and delete push subscription", async () => {
  const reg = await subscribe(subCookie, {
    deviceId: "d1",
    kind: "webpush",
    endpoint: "https://push.example/ep1",
    p256dh: "pk",
    auth: "au",
  });
  expect(reg.status).toBe(200);

  const list = await exports.default.fetch("http://localhost/api/v1/users/me/push_subscriptions", {
    headers: { cookie: subCookie },
  });
  expect(list.status).toBe(200);
  const body = (await list.json()) as {
    subscriptions: {
      deviceId: string;
      kind: string;
      endpoint: string;
      p256dh: string | null;
      auth: string | null;
      updatedAt: number;
    }[];
  };
  expect(body.subscriptions).toHaveLength(1);
  expect(body.subscriptions[0]).toMatchObject({
    deviceId: "d1",
    kind: "webpush",
    endpoint: "https://push.example/ep1",
    p256dh: "pk",
    auth: "au",
  });

  const del = await exports.default.fetch(
    "http://localhost/api/v1/users/me/push_subscriptions/d1",
    {
      method: "DELETE",
      headers: { cookie: subCookie },
    },
  );
  expect(del.status).toBe(200);

  const after = await exports.default.fetch("http://localhost/api/v1/users/me/push_subscriptions", {
    headers: { cookie: subCookie },
  });
  const afterBody = (await after.json()) as { subscriptions: unknown[] };
  expect(afterBody.subscriptions).toHaveLength(0);
});

test("upsert same deviceId updates endpoint and keeps one row", async () => {
  await subscribe(subCookie, {
    deviceId: "d2",
    kind: "webpush",
    endpoint: "https://push.example/ep2",
    p256dh: "pk2",
    auth: "au2",
  });
  const reg2 = await subscribe(subCookie, {
    deviceId: "d2",
    kind: "webpush",
    endpoint: "https://push.example/ep2-new",
    p256dh: "pk2-new",
    auth: "au2-new",
  });
  expect(reg2.status).toBe(200);

  const list = await exports.default.fetch("http://localhost/api/v1/users/me/push_subscriptions", {
    headers: { cookie: subCookie },
  });
  const body = (await list.json()) as {
    subscriptions: { deviceId: string; endpoint: string; p256dh: string | null }[];
  };
  const d2 = body.subscriptions.filter((s) => s.deviceId === "d2");
  expect(d2).toHaveLength(1);
  expect(d2[0]).toMatchObject({
    endpoint: "https://push.example/ep2-new",
    p256dh: "pk2-new",
  });
});

test("requires session", async () => {
  const post = await exports.default.fetch("http://localhost/api/v1/users/me/push_subscriptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: "d3", kind: "webpush", endpoint: "https://push.example/ep3" }),
  });
  expect(post.status).toBe(401);

  const get = await exports.default.fetch("http://localhost/api/v1/users/me/push_subscriptions");
  expect(get.status).toBe(401);

  const del = await exports.default.fetch(
    "http://localhost/api/v1/users/me/push_subscriptions/d3",
    {
      method: "DELETE",
    },
  );
  expect(del.status).toBe(401);
});

test("exposes vapid public key", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/users/me/vapid_public_key", {
    headers: { cookie: subCookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { publicKey: string };
  expect(body.publicKey).toBe("local-vapid-public-key");
});

let internalCookie = "";
let internalUserId = "";

beforeAll(async () => {
  const u = await signup("internal-push@test.dev", "internal-push-password");
  internalCookie = u.cookie;
  const tokenRes = await exports.default.fetch("http://localhost/api/auth/token", {
    headers: { cookie: internalCookie },
  });
  const { token } = (await tokenRes.json()) as { token: string };
  const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as {
    sub: string;
  };
  internalUserId = payload.sub;
});

async function registerInternalSubscription() {
  return subscribe(internalCookie, {
    deviceId: "ip1",
    kind: "webpush",
    endpoint: "https://push.example/ip1",
    p256dh: "pk",
    auth: "au",
  });
}

function internalGet(token?: string) {
  return exports.default.fetch(
    `http://localhost/internal/push-user/${internalUserId}/subscriptions`,
    { headers: token ? { "x-internal-token": token } : {} },
  );
}

test("internal subscriptions endpoint requires token", async () => {
  await registerInternalSubscription();
  const res = await internalGet();
  expect(res.status).toBe(403);
});

test("internal subscriptions list and delete via token", async () => {
  await registerInternalSubscription();

  const list = await internalGet(env.INTERNAL_TOKEN_KEY);
  expect(list.status).toBe(200);
  const body = (await list.json()) as {
    subscriptions: { deviceId: string; kind: string; endpoint: string }[];
  };
  expect(body.subscriptions).toContainEqual(
    expect.objectContaining({
      deviceId: "ip1",
      kind: "webpush",
      endpoint: "https://push.example/ip1",
    }),
  );

  const del = await exports.default.fetch(
    `http://localhost/internal/push-user/${internalUserId}/subscriptions`,
    {
      method: "DELETE",
      headers: {
        "x-internal-token": env.INTERNAL_TOKEN_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ deviceId: "ip1" }),
    },
  );
  expect(del.status).toBe(200);
  expect(await del.json()).toEqual({ ok: true });

  const after = await internalGet(env.INTERNAL_TOKEN_KEY);
  const afterBody = (await after.json()) as { subscriptions: { deviceId: string }[] };
  expect(afterBody.subscriptions).not.toContainEqual(expect.objectContaining({ deviceId: "ip1" }));
});

test("internal delete requires token", async () => {
  const res = await exports.default.fetch(
    `http://localhost/internal/push-user/${internalUserId}/subscriptions`,
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: "ip1" }),
    },
  );
  expect(res.status).toBe(403);
});

let decisionCookie = "";
let decisionId = "";
let decisionChannelId = "";

function jwtSubject(token: string): string {
  const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as {
    sub: string;
  };
  return payload.sub;
}

beforeAll(async () => {
  const signupAlice = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "alice@push-decision.dev",
      password: "push-decision-test-password",
      name: "Alice",
      username: "alice",
    }),
  });
  decisionCookie = signupAlice.headers.get("set-cookie") ?? "";
  const tokenAlice = await exports.default.fetch("http://localhost/api/auth/token", {
    headers: { cookie: decisionCookie },
  });
  decisionId = jwtSubject(((await tokenAlice.json()) as { token: string }).token);

  const teamId = await createTeam(decisionCookie, "pd", "PD");
  decisionChannelId = await createChannel(decisionCookie, teamId, "general", "General");
});

function decisionUserStub() {
  return env.USER_DO.get(env.USER_DO.idFromName(userDoName(decisionId)));
}

async function decisionSubscribe() {
  return subscribe(decisionCookie, {
    deviceId: "d1",
    kind: "webpush",
    endpoint: "https://push.example/ep1",
    p256dh: "pk",
    auth: "au",
  });
}

async function push(events: unknown[]) {
  return decisionUserStub().push({ channelId: decisionChannelId, events });
}

test("subscribing an endpoint allows push decision to reach enqueue", async () => {
  const res = await decisionSubscribe();
  expect(res.status).toBe(200);

  const base = {
    type: "message.new",
    message: { id: "m1", content: "hello", mentions: [] },
    notifPref: "all",
  };
  await expect(push([base])).resolves.toBeUndefined();

  await expect(push([{ ...base, notifPref: "none" }])).resolves.toBeUndefined();
  await expect(
    push([
      {
        ...base,
        message: { id: "m2", content: "no mention", mentions: [] },
        notifPref: "mention",
      },
    ]),
  ).resolves.toBeUndefined();
  await expect(
    push([
      {
        ...base,
        message: { id: "m3", content: "hi @alice", mentions: [decisionId] },
        notifPref: "mention",
      },
    ]),
  ).resolves.toBeUndefined();

  await expect(push([base])).resolves.toBeUndefined();
});

test("push decision resolves for other event types", async () => {
  await expect(
    push([{ type: "channel.read", channelId: decisionChannelId, lastReadSeq: 1 }]),
  ).resolves.toBeUndefined();
  await expect(push([{ type: "typing.start", userId: "bob" }])).resolves.toBeUndefined();
});

let prefOwner = "";
let prefOutsider = "";
let prefOwnerId = "";
let prefChannelId = "";

beforeAll(async () => {
  const owner = await signup("np-owner@test.dev", "notify-test-password");
  prefOwner = owner.cookie;
  prefOwnerId = owner.id;
  prefOutsider = (await signup("np-outsider@test.dev", "notify-test-password")).cookie;
  const teamId = await createTeam(prefOwner, "np", "NP");
  prefChannelId = await createChannel(prefOwner, teamId, "general", "General");
});

async function setPref(cookie: string, userId: string, pref: string) {
  return exports.default.fetch(
    `http://localhost/api/v1/channels/${prefChannelId}/members/${userId}/notifyProps`,
    {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ notifyProps: { pref } }),
    },
  );
}

test("set notify pref returns ok", async () => {
  const res = await setPref(prefOwner, prefOwnerId, "mention");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean };
  expect(body.ok).toBe(true);
});

test("invalid pref returns 422", async () => {
  const res = await setPref(prefOwner, prefOwnerId, "bogus");
  expect(res.status).toBe(422);
});

test("non-member cannot set notify pref", async () => {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/channels/${prefChannelId}/members/${prefOwnerId}/notifyProps`,
    {
      method: "PUT",
      headers: { cookie: prefOutsider, "content-type": "application/json" },
      body: JSON.stringify({ notifyProps: { pref: "all" } }),
    },
  );
  expect(res.status).toBe(403);
});

test("requires session", async () => {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/channels/${prefChannelId}/members/${prefOwnerId}/notifyProps`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notifyProps: { pref: "all" } }),
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
