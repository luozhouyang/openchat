import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { userDoName } from "protocol";
import type { PresenceStatus } from "protocol";
import { eq } from "drizzle-orm";
import { getDb } from "../../../src/worker/db/client.ts";
import * as schemaD1 from "../../../src/worker/db/schema-d1.ts";

let aliceCookie = "";
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

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out");
}

async function d1Status(userId: string) {
  const rows = await getDb(env.DB)
    .select()
    .from(schemaD1.userStatus)
    .where(eq(schemaD1.userStatus.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

test("no connections means offline", async () => {
  const { status } = await userStub("presence-nobody").presenceStatus();
  expect(status).toBe("offline");
});

test("presence is online while connected and offline after close", async () => {
  const alice = await upgrade(aliceCookie, "d1");
  const hello = await nextMessage(alice);
  expect(JSON.parse(String(hello.data))).toMatchObject({ type: "hello" });
  await waitForStatus(aliceId, "online");
  alice.close(1000, "done");
  await waitForStatus(aliceId, "offline");
});

test("connect and disconnect write online/offline into D1 user_status", async () => {
  const alice = await upgrade(aliceCookie, "d1");
  const hello = await nextMessage(alice);
  expect(JSON.parse(String(hello.data))).toMatchObject({ type: "hello" });

  await waitFor(async () => (await d1Status(aliceId))?.online === true);
  const online = await d1Status(aliceId);
  expect(online).toMatchObject({ userId: aliceId, status: "online" });

  alice.close(1000, "done");
  await waitFor(async () => (await d1Status(aliceId))?.online === false);
  const offline = await d1Status(aliceId);
  expect(offline?.status).toBe("offline");
});

test("manual status persists to D1 and survives connect/disconnect", async () => {
  const stub = userStub(aliceId);
  const dndEndTime = Date.now() + 3600_000;
  await stub.setStatus(aliceId, { status: "dnd", manual: true, dndEndTime });

  const alice = await upgrade(aliceCookie, "d1");
  await waitFor(async () => (await d1Status(aliceId))?.online === true);
  const row = await d1Status(aliceId);
  // manual status overrides the auto transition: display stays dnd, but the
  // online boolean reflects connectivity so the user still gets real-time.
  expect(row).toMatchObject({ userId: aliceId, status: "dnd", manual: true, dndEndTime });
  expect(row?.online).toBe(true);

  alice.close(1000, "done");
});
