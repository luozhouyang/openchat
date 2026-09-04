import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../src/worker/db/client.ts";
import { teamMembers, users } from "../../../src/worker/db/schema-d1.ts";
import { listRoles } from "../../../src/worker/db/repos/roles.ts";
import { PERMISSIONS, resolvePermissions } from "../../../src/worker/auth/rbac.ts";

const db = getDb(env.DB);

const SEED_NAMES = [
  "system_user",
  "system_admin",
  "team_user",
  "team_admin",
  "channel_user",
  "channel_admin",
];

let userCookie = "";
let userId = "";
let teamId = "";

async function signup(email: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "rbac-test-password",
      name: email.split("@")[0],
      username: email.split("@")[0],
    }),
  });
  return res.headers.get("set-cookie") ?? "";
}

beforeAll(async () => {
  userCookie = await signup("rbac-user@test.dev");
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie: userCookie },
  });
  userId = ((await me.json()) as { user: { id: string } }).user.id;
  const team = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie: userCookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "rbacteam", displayName: "RbacTeam", type: "open" }),
  });
  teamId = ((await team.json()) as { id: string }).id;
});

test("bootstrap seeds the 6 built-in roles idempotently", async () => {
  const first = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie: userCookie },
  });
  expect(first.status).toBe(200);
  const second = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie: userCookie },
  });
  expect(second.status).toBe(200);

  const roles = await listRoles(db);
  const names = new Set(roles.map((r) => r.name));
  for (const name of SEED_NAMES) expect(names.has(name)).toBe(true);
  const builtIn = roles.filter((r) => r.builtIn);
  expect(builtIn).toHaveLength(SEED_NAMES.length);
});

test("resolvePermissions maps system admin and team roles", async () => {
  await db.update(users).set({ role: "admin" }).where(eq(users.id, userId));
  const systemPerms = await resolvePermissions(db, userId, {});
  expect(systemPerms.has(PERMISSIONS.MANAGE_SYSTEM)).toBe(true);

  await db.update(users).set({ role: "user" }).where(eq(users.id, userId));
  const teamPerms = await resolvePermissions(db, userId, { teamId });
  expect(teamPerms.has(PERMISSIONS.MANAGE_TEAMS)).toBe(true);
  expect(teamPerms.has(PERMISSIONS.MANAGE_CHANNEL_ROLES)).toBe(false);
});

test("requirePermission via endpoint: team patch needs MANAGE_TEAMS", async () => {
  const plainCookie = await signup("rbac-plain@test.dev");
  const join = await exports.default.fetch(`http://localhost/api/v1/teams/${teamId}/members`, {
    method: "POST",
    headers: { cookie: plainCookie, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(join.status).toBe(200);

  const denied = await exports.default.fetch(`http://localhost/api/v1/teams/${teamId}/patch`, {
    method: "PUT",
    headers: { cookie: plainCookie, "content-type": "application/json" },
    body: JSON.stringify({ displayName: "Nope" }),
  });
  expect(denied.status).toBe(403);

  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie: plainCookie },
  });
  const plainId = ((await me.json()) as { user: { id: string } }).user.id;
  await db
    .update(teamMembers)
    .set({ roles: "team_admin" })
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, plainId)));

  const allowed = await exports.default.fetch(`http://localhost/api/v1/teams/${teamId}/patch`, {
    method: "PUT",
    headers: { cookie: plainCookie, "content-type": "application/json" },
    body: JSON.stringify({ displayName: "Renamed" }),
  });
  expect(allowed.status).toBe(200);
});
