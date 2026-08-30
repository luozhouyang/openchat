import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { userDoName } from "protocol";
import type { PresenceStatus } from "protocol";

let aliceCookie = "";
let watcherCookie = "";
let aliceId = "";

beforeAll(async () => {
  const signupAlice = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "alice@presence.dev",
      password: "presence-test-password",
      name: "Alice",
    }),
  });
  aliceCookie = signupAlice.headers.get("set-cookie") ?? "";
  const tokenAlice = await exports.default.fetch("http://localhost/api/auth/token", {
    headers: { cookie: aliceCookie },
  });
  aliceId = jwtSubject(((await tokenAlice.json()) as { token: string }).token);

  const signupWatcher = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "watcher@presence.dev",
      password: "presence-test-password",
      name: "Watcher",
    }),
  });
  watcherCookie = signupWatcher.headers.get("set-cookie") ?? "";
});

function jwtSubject(token: string): string {
  const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as {
    sub: string;
  };
  return payload.sub;
}

function userStub(userId: string) {
  return env.USER_DO.get(env.USER_DO.idFromName(userDoName(userId)));
}

async function upgrade(cookie: string, deviceId: string): Promise<WebSocket> {
  const tokenRes = await exports.default.fetch("http://localhost/api/auth/token", {
    headers: { cookie },
  });
  const { token } = (await tokenRes.json()) as { token: string };
  const res = await exports.default.fetch(
    new Request(`http://localhost/ws?deviceId=${deviceId}`, {
      headers: { Upgrade: "websocket", authorization: `Bearer ${token}` },
    }),
  );
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  expect(ws).toBeDefined();
  ws!.accept();
  return ws!;
}

function nextMessage(ws: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (event) => resolve(event as MessageEvent), { once: true });
  });
}

async function waitForStatus(userId: string, expected: PresenceStatus, timeoutMs = 5000) {
  const stub = userStub(userId);
  const deadline = Date.now() + timeoutMs;
  let status: PresenceStatus = "offline";
  while (Date.now() < deadline) {
    ({ status } = await stub.presenceStatus());
    if (status === expected) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(status).toBe(expected);
}

test("no connections means offline", async () => {
  const { status } = await userStub("presence-nobody").presenceStatus();
  expect(status).toBe("offline");
});

test("presenceSubscribe and presenceUnsubscribe lifecycle", async () => {
  const target = userStub("presence-target");
  await target.presenceSubscribe({
    subscriberId: "lifecycle-watcher",
    expiresAt: Date.now() + 86_400_000,
  });
  await target.presenceSubscribe({
    subscriberId: "lifecycle-watcher",
    expiresAt: Date.now() + 2 * 86_400_000,
  });
  await target.presenceUnsubscribe({ subscriberId: "lifecycle-watcher" });
  await target.presenceUnsubscribe({ subscriberId: "lifecycle-watcher" });
});

test("presence is online while connected and offline after close", async () => {
  const alice = await upgrade(aliceCookie, "d1");
  const hello = await nextMessage(alice);
  expect(JSON.parse(String(hello.data))).toMatchObject({ type: "hello" });
  await waitForStatus(aliceId, "online");
  alice.close(1000, "done");
  await waitForStatus(aliceId, "offline");
});

test("subscriber receives presence.update frames across online and offline", async () => {
  const watcher = await upgrade(watcherCookie, "d1");
  const hello = await nextMessage(watcher);
  expect(JSON.parse(String(hello.data))).toMatchObject({ type: "hello" });

  watcher.send(JSON.stringify({ type: "presence_subscribe", userIds: [aliceId] }));
  const snapshot = await nextMessage(watcher);
  expect(JSON.parse(String(snapshot.data))).toEqual({
    type: "presence.snapshot",
    states: { [aliceId]: "offline" },
  });

  const onlineFrame = nextMessage(watcher);
  const alice = await upgrade(aliceCookie, "d1");
  const aliceHello = await nextMessage(alice);
  expect(JSON.parse(String(aliceHello.data))).toMatchObject({ type: "hello" });
  const online = await onlineFrame;
  expect(JSON.parse(String(online.data))).toEqual({
    type: "presence.update",
    userId: aliceId,
    status: "online",
  });

  const offlineFrame = nextMessage(watcher);
  alice.close(1000, "done");
  const offline = await offlineFrame;
  expect(JSON.parse(String(offline.data))).toEqual({
    type: "presence.update",
    userId: aliceId,
    status: "offline",
  });

  watcher.send(JSON.stringify({ type: "presence_unsubscribe", userIds: [aliceId] }));
  const snapshot2 = await nextMessage(watcher);
  expect(JSON.parse(String(snapshot2.data))).toEqual({
    type: "presence.snapshot",
    states: { [aliceId]: "offline" },
  });

  const silent = nextMessage(watcher);
  const alice2 = await upgrade(aliceCookie, "d2");
  const alice2Hello = await nextMessage(alice2);
  expect(JSON.parse(String(alice2Hello.data))).toMatchObject({ type: "hello" });
  const race = await Promise.race([
    silent.then(() => "frame"),
    new Promise<string>((r) => setTimeout(() => r("timeout"), 400)),
  ]);
  expect(race).toBe("timeout");

  alice2.close(1000, "done");
  watcher.close(1000, "done");
});
