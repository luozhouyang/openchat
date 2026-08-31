import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { signup, userIdOf } from "../helpers/setup.ts";

let sysAdminCookie = "";
let sysAdminId = "";
let ownerCookie = "";
let memberCookie = "";
let memberId = "";
let plainCookie = "";
let teamId = "";
let channelId = "";

interface RoleRow {
  id: string;
  name: string;
  displayName: string;
  permissions: string[];
  builtIn: boolean;
}

async function fetchAs(cookie: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookie);
  return exports.default.fetch(`http://localhost${path}`, { ...init, headers });
}

beforeAll(async () => {
  sysAdminCookie = await signup(
    exports.default,
    "roles-admin@test.dev",
    "roles-test-password",
    "SysAdmin",
  );
  sysAdminId = await userIdOf(exports.default, sysAdminCookie);
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(sysAdminId).run();

  ownerCookie = await signup(exports.default, "roles-owner@test.dev", "roles-test-password");
  memberCookie = await signup(exports.default, "roles-member@test.dev", "roles-test-password");
  memberId = await userIdOf(exports.default, memberCookie);
  plainCookie = await signup(exports.default, "roles-plain@test.dev", "roles-test-password");

  const team = await fetchAs(ownerCookie, "/api/v1/teams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "rolesco", displayName: "RolesCo", type: "open" }),
  });
  teamId = ((await team.json()) as { id: string }).id;

  const chan = await fetchAs(ownerCookie, "/api/v1/channels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      teamId,
      name: "general",
      displayName: "General",
      type: "public",
    }),
  });
  channelId = ((await chan.json()) as { id: string }).id;

  await fetchAs(memberCookie, `/api/v1/teams/${teamId}/members`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  await fetchAs(memberCookie, `/api/v1/channels/${channelId}/members`, { method: "POST" });
  await fetchAs(plainCookie, `/api/v1/teams/${teamId}/members`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
});

test("GET /roles as system admin returns seed roles including system_admin", async () => {
  const res = await fetchAs(sysAdminCookie, "/api/v1/roles");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { roles: RoleRow[] };
  const names = body.roles.map((r) => r.name);
  expect(names).toContain("system_admin");
  expect(names).toContain("team_admin");
  const systemAdmin = body.roles.find((r) => r.name === "system_admin")!;
  expect(systemAdmin.permissions).toContain("manage_roles");
  expect(typeof systemAdmin.builtIn).toBe("boolean");
});

test("GET /roles rejects a normal user", async () => {
  const res = await fetchAs(plainCookie, "/api/v1/roles");
  expect(res.status).toBe(403);
});

test("GET /schemes returns a schemes array for system admin", async () => {
  const res = await fetchAs(sysAdminCookie, "/api/v1/schemes");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { schemes: unknown[] };
  expect(Array.isArray(body.schemes)).toBe(true);
});

test("PUT team member roles as team_admin updates team_members.roles", async () => {
  const res = await fetchAs(ownerCookie, `/api/v1/teams/${teamId}/members/${memberId}/roles`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roles: ["team_admin"] }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });

  const row = await env.DB.prepare(
    "SELECT roles FROM team_members WHERE team_id = ?1 AND user_id = ?2",
  )
    .bind(teamId, memberId)
    .first();
  expect(row?.roles).toBe("team_admin");
});

test("PUT team member roles as non-admin returns 403", async () => {
  const res = await fetchAs(plainCookie, `/api/v1/teams/${teamId}/members/${memberId}/roles`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roles: ["team_admin"] }),
  });
  expect(res.status).toBe(403);
});

test("PUT channel member roles as channel_admin updates channel_members.roles", async () => {
  const res = await fetchAs(
    ownerCookie,
    `/api/v1/channels/${channelId}/members/${memberId}/roles`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roles: ["channel_admin"] }),
    },
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });

  const row = await env.DB.prepare(
    "SELECT roles FROM channel_members WHERE channel_id = ?1 AND user_id = ?2",
  )
    .bind(channelId, memberId)
    .first();
  expect(row?.roles).toBe("channel_admin");
});

test("PUT channel member roles as non-admin returns 403", async () => {
  const res = await fetchAs(
    plainCookie,
    `/api/v1/channels/${channelId}/members/${memberId}/roles`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roles: ["channel_admin"] }),
    },
  );
  expect(res.status).toBe(403);
});

test("PUT user roles as system admin maps system_admin to users.role admin", async () => {
  const res = await fetchAs(sysAdminCookie, `/api/v1/users/${memberId}/roles`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roles: ["system_admin"] }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });

  const row = await env.DB.prepare("SELECT role FROM users WHERE id = ?1").bind(memberId).first();
  expect(row?.role).toBe("admin");
});

test("PUT /users/me/roles wildcard resolves to the session user", async () => {
  const res = await fetchAs(sysAdminCookie, "/api/v1/users/me/roles", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roles: ["system_admin"] }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });

  const row = await env.DB.prepare("SELECT role FROM users WHERE id = ?1").bind(sysAdminId).first();
  expect(row?.role).toBe("admin");
});

test("PUT team member roles for a missing member returns 404", async () => {
  const res = await fetchAs(ownerCookie, `/api/v1/teams/${teamId}/members/nonexistent/roles`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roles: ["team_admin"] }),
  });
  expect(res.status).toBe(404);
});

test("PUT channel member roles for a missing member returns 404", async () => {
  const res = await fetchAs(
    ownerCookie,
    `/api/v1/channels/${channelId}/members/nonexistent/roles`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roles: ["channel_admin"] }),
    },
  );
  expect(res.status).toBe(404);
});
