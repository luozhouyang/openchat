import { expect, test, beforeAll } from "vite-plus/test";
import { env, runInDurableObject } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { userDoName } from "protocol";
import { getDb } from "../../../src/worker/db/client.ts";
import { users } from "../../../src/worker/db/schema-d1.ts";

async function signup(email: string, password: string): Promise<{ cookie: string; id: string }> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name: email.split("@")[0] }),
  });
  const cookie = res.headers.get("set-cookie") ?? "";
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie },
  });
  const { user } = (await me.json()) as { user: { id: string } };
  return { cookie, id: user.id };
}

async function makeAdmin(cookie: string, id: string) {
  await getDb(env.DB).update(users).set({ role: "admin" }).where(eq(users.id, id));
  return cookie;
}

function banRequest(cookie: string, userId: string): Promise<Response> {
  return exports.default.fetch("http://localhost/api/auth/admin/ban-user", {
    method: "POST",
    headers: {
      cookie,
      origin: "http://localhost:8787",
      "content-type": "application/json",
    },
    body: JSON.stringify({ userId, banReason: "test" }),
  });
}

function jwtSubject(token: string): string {
  const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as {
    sub: string;
  };
  return payload.sub;
}

let flowAdminCookie = "";
let flowVictimCookie = "";
let flowVictimId = "";

beforeAll(async () => {
  const admin = await signup("ban-admin@test.dev", "ban-flow-password");
  flowAdminCookie = await makeAdmin(admin.cookie, admin.id);
  const victim = await signup("ban-victim@test.dev", "ban-flow-password");
  flowVictimCookie = victim.cookie;
  flowVictimId = victim.id;
});

test("victim session is valid before ban", async () => {
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie: flowVictimCookie },
  });
  expect(me.status).toBe(200);
});

test("admin bans victim", async () => {
  const ban = await banRequest(flowAdminCookie, flowVictimId);
  expect(ban.status).toBe(200);
});

test("victim /me is revoked after ban", async () => {
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie: flowVictimCookie },
  });
  expect(me.status).toBe(401);
});

test("victim get-session is revoked after ban", async () => {
  const session = await exports.default.fetch("http://localhost/api/auth/get-session", {
    headers: { cookie: flowVictimCookie },
  });
  const body = session.status === 200 ? await session.json() : null;
  expect(session.status === 401 || (session.status === 200 && body === null)).toBe(true);
});

test("ban hook forces disconnect on victim user do", async () => {
  const h = await env.USER_DO.get(env.USER_DO.idFromName(userDoName(flowVictimId))).health();
  expect(h.disconnectUntil).toBeGreaterThan(Date.now());
});

test("non-admin cannot ban", async () => {
  const plain = await signup("ban-plain@test.dev", "ban-flow-password");
  const ban = await banRequest(plain.cookie, flowVictimId);
  expect(ban.status).toBe(403);
});

let wsAdminCookie = "";
let wsVictimCookie = "";
let wsVictimId = "";
let wsVictimToken = "";

beforeAll(async () => {
  const admin = await signup("banws-admin@test.dev", "ban-ws-password");
  wsAdminCookie = await makeAdmin(admin.cookie, admin.id);
  const victim = await signup("banws-victim@test.dev", "ban-ws-password");
  wsVictimCookie = victim.cookie;
  wsVictimId = victim.id;
  const tokenRes = await exports.default.fetch("http://localhost/api/auth/token", {
    headers: { cookie: wsVictimCookie },
  });
  wsVictimToken = ((await tokenRes.json()) as { token: string }).token;
  expect(jwtSubject(wsVictimToken)).toBe(wsVictimId);
});

function victimStub() {
  return env.USER_DO.get(env.USER_DO.idFromName(userDoName(wsVictimId)));
}

function wsRequest(token: string): Request {
  return new Request("http://localhost/ws?deviceId=ban-d1", {
    headers: { Upgrade: "websocket", authorization: `Bearer ${token}` },
  });
}

test("victim /ws with bearer jwt succeeds before ban", async () => {
  const res = await exports.default.fetch(wsRequest(wsVictimToken));
  expect(res.status).toBe(101);
});

test("banned victim /ws with still-valid jwt rejected inside window", async () => {
  await banRequest(wsAdminCookie, wsVictimId);
  const h = await victimStub().health();
  expect(h.disconnectUntil).toBeGreaterThan(Date.now());
  const res = await exports.default.fetch(wsRequest(wsVictimToken));
  expect(res.status).toBe(403);
});

test("banned victim /me bearer route rejected", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { authorization: `Bearer ${wsVictimToken}` },
  });
  expect(res.status).toBe(403);
});

test("banned victim /ws rejected after disconnectUntil window passes", async () => {
  await runInDurableObject(victimStub(), async (instance, state) => {
    instance.disconnectUntil = Date.now() - 1000;
    await state.storage.put("disconnectUntil", instance.disconnectUntil);
  });
  const h = await victimStub().health();
  expect(h.disconnectUntil).toBeLessThan(Date.now());
  const res = await exports.default.fetch(wsRequest(wsVictimToken));
  expect(res.status).toBe(403);
});
