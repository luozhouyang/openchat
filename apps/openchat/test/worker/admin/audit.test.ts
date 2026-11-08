import { env, exports } from "cloudflare:workers";
import { expect, test, beforeAll } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { getDb } from "@worker/db/client";
import { users } from "@worker/db/schema-d1";

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

async function makeAdmin(cookie: string, id: string) {
  await getDb(env.DB).update(users).set({ role: "admin" }).where(eq(users.id, id));
  return cookie;
}

async function createTeam(cookie: string, name: string, displayName: string) {
  const res = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name, displayName, type: "open" }),
  });
  return (await res.json()) as { id?: string; error?: string };
}

interface AuditEntry {
  id: string;
  actorId: string;
  action: string;
  target: string | null;
  status: string;
  detail: unknown;
  createdAt: number;
}

let adminCookie = "";
let adminUserId = "";
let teamId = "";

beforeAll(async () => {
  const admin = await signup("audit-admin@test.dev", "audit-test-password");
  adminCookie = await makeAdmin(admin.cookie, admin.id);
  adminUserId = admin.id;

  const team = await createTeam(adminCookie, "audit", "Audit");
  teamId = team.id!;
});

test("admin audit endpoint returns the team archive entry", async () => {
  const archive = await exports.default.fetch(
    `http://localhost/api/v1/admin/teams/${teamId}/archive`,
    { method: "POST", headers: { cookie: adminCookie } },
  );
  expect(archive.status).toBe(200);

  const res = await exports.default.fetch("http://localhost/api/v1/admin/audit", {
    headers: { cookie: adminCookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { entries: AuditEntry[] };
  const entry = body.entries.find(
    (e) => e.action === "team.archive" && e.actorId === adminUserId && e.target === teamId,
  );
  expect(entry).toBeTruthy();
  expect(entry!.status).toBe("ok");
});

test("admin audit endpoint rejects non-admin", async () => {
  const plain = await signup("audit-plain@test.dev", "audit-test-password");
  const res = await exports.default.fetch("http://localhost/api/v1/admin/audit", {
    headers: { cookie: plain.cookie },
  });
  expect(res.status).toBe(403);
});
