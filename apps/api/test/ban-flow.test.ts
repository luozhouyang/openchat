import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { userDoName } from "protocol";

let adminCookie = "";
let adminId = "";
let victimCookie = "";
let victimId = "";

async function signup(email: string): Promise<{ cookie: string; id: string }> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "ban-flow-password", name: email.split("@")[0] }),
  });
  const cookie = res.headers.get("set-cookie") ?? "";
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie },
  });
  const { user } = (await me.json()) as { user: { id: string } };
  return { cookie, id: user.id };
}

beforeAll(async () => {
  const admin = await signup("ban-admin@test.dev");
  adminCookie = admin.cookie;
  adminId = admin.id;
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(adminId).run();
  const victim = await signup("ban-victim@test.dev");
  victimCookie = victim.cookie;
  victimId = victim.id;
});

test("victim session is valid before ban", async () => {
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie: victimCookie },
  });
  expect(me.status).toBe(200);
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

test("victim /me is revoked after ban", async () => {
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie: victimCookie },
  });
  expect(me.status).toBe(401);
});

test("victim get-session is revoked after ban", async () => {
  const session = await exports.default.fetch("http://localhost/api/auth/get-session", {
    headers: { cookie: victimCookie },
  });
  const body = session.status === 200 ? await session.json() : null;
  expect(session.status === 401 || (session.status === 200 && body === null)).toBe(true);
});

test("ban hook forces disconnect on victim user do", async () => {
  const h = await env.USER_DO.get(env.USER_DO.idFromName(userDoName(victimId))).health();
  expect(h.disconnectUntil).toBeGreaterThan(Date.now());
});

test("non-admin cannot ban", async () => {
  const plain = await signup("ban-plain@test.dev");
  const ban = await exports.default.fetch("http://localhost/api/auth/admin/ban-user", {
    method: "POST",
    headers: {
      cookie: plain.cookie,
      origin: "http://localhost:8787",
      "content-type": "application/json",
    },
    body: JSON.stringify({ userId: victimId, banReason: "test" }),
  });
  expect(ban.status).toBe(403);
});
