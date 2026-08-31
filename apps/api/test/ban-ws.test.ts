import { expect, test, beforeAll } from "vite-plus/test";
import { env, runInDurableObject } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { userDoName } from "protocol";
import { getDb } from "../src/db/client.ts";
import { users } from "../src/db/schema-d1.ts";

let adminCookie = "";
let victimCookie = "";
let victimId = "";
let victimToken = "";

async function signup(email: string): Promise<{ cookie: string; id: string }> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "ban-ws-password", name: email.split("@")[0] }),
  });
  const cookie = res.headers.get("set-cookie") ?? "";
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie },
  });
  const { user } = (await me.json()) as { user: { id: string } };
  return { cookie, id: user.id };
}

function jwtSubject(token: string): string {
  const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as {
    sub: string;
  };
  return payload.sub;
}

function victimStub() {
  return env.USER_DO.get(env.USER_DO.idFromName(userDoName(victimId)));
}

function wsRequest(token: string): Request {
  return new Request("http://localhost/ws?deviceId=ban-d1", {
    headers: { Upgrade: "websocket", authorization: `Bearer ${token}` },
  });
}

beforeAll(async () => {
  const admin = await signup("banws-admin@test.dev");
  adminCookie = admin.cookie;
  await getDb(env.DB).update(users).set({ role: "admin" }).where(eq(users.id, admin.id));
  const victim = await signup("banws-victim@test.dev");
  victimCookie = victim.cookie;
  victimId = victim.id;
  const tokenRes = await exports.default.fetch("http://localhost/api/auth/token", {
    headers: { cookie: victimCookie },
  });
  victimToken = ((await tokenRes.json()) as { token: string }).token;
  expect(jwtSubject(victimToken)).toBe(victimId);
});

test("victim /ws with bearer jwt succeeds before ban", async () => {
  const res = await exports.default.fetch(wsRequest(victimToken));
  expect(res.status).toBe(101);
});

test("admin bans victim", async () => {
  const ban = await exports.default.fetch("http://localhost/api/auth/admin/ban-user", {
    method: "POST",
    headers: {
      cookie: adminCookie,
      origin: "http://localhost:8787",
      "content-type": "application/json",
    },
    body: JSON.stringify({ userId: victimId, banReason: "test" }),
  });
  expect(ban.status).toBe(200);
});

test("banned victim /ws with still-valid jwt rejected inside window", async () => {
  const h = await victimStub().health();
  expect(h.disconnectUntil).toBeGreaterThan(Date.now());
  const res = await exports.default.fetch(wsRequest(victimToken));
  expect(res.status).toBe(403);
});

test("banned victim /me bearer route rejected", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { authorization: `Bearer ${victimToken}` },
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
  const res = await exports.default.fetch(wsRequest(victimToken));
  expect(res.status).toBe(403);
});
