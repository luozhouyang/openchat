import { expect, test } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../../../src/worker/db/client.ts";
import { roles, users } from "../../../src/worker/db/schema-d1.ts";

async function signup(email: string): Promise<{ cookie: string; userId: string }> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "role-test-password", name: email.split("@")[0] }),
  });
  const cookie = res.headers.get("set-cookie") ?? "";
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie },
  });
  const { user } = (await me.json()) as { user: { id: string } };
  return { cookie, userId: user.id };
}

async function makeAdmin(userId: string): Promise<void> {
  await getDb(env.DB).update(users).set({ role: "admin" }).where(eq(users.id, userId));
}

test("put role permissions requires admin and validates permissions", async () => {
  const user = await signup("roles-user@test.dev");
  const admin = await signup("roles-admin@test.dev");
  await makeAdmin(admin.userId);

  const list = await exports.default.fetch("http://localhost/api/v1/roles", {
    headers: { cookie: admin.cookie },
  });
  const { roles: roleRows } = (await list.json()) as {
    roles: { id: string; name: string; permissions: string[] }[];
  };
  const systemUser = roleRows.find((r) => r.name === "system_user");
  expect(systemUser).toBeTruthy();

  const db = getDb(env.DB);
  const [systemUserRow] = await db
    .select()
    .from(roles)
    .where(eq(roles.name, "system_user"))
    .limit(1);
  expect(systemUserRow).toBeTruthy();
  const orig = systemUserRow!.permissions;

  try {
    const nonAdmin = await exports.default.fetch(
      `http://localhost/api/v1/roles/${systemUser!.id}`,
      {
        method: "PUT",
        headers: { cookie: user.cookie, "content-type": "application/json" },
        body: JSON.stringify({ permissions: [] }),
      },
    );
    expect(nonAdmin.status).toBe(403);

    const unknown = await exports.default.fetch(`http://localhost/api/v1/roles/${systemUser!.id}`, {
      method: "PUT",
      headers: { cookie: admin.cookie, "content-type": "application/json" },
      body: JSON.stringify({ permissions: ["no_such_perm"] }),
    });
    expect(unknown.status).toBe(422);

    const ok = await exports.default.fetch(`http://localhost/api/v1/roles/${systemUser!.id}`, {
      method: "PUT",
      headers: { cookie: admin.cookie, "content-type": "application/json" },
      body: JSON.stringify({ permissions: ["view_team"] }),
    });
    expect(ok.status).toBe(200);
    const saved = (await ok.json()) as { role: { permissions: string[] } };
    expect(saved.role.permissions).toEqual(["view_team"]);

    const notFound = await exports.default.fetch("http://localhost/api/v1/roles/nope", {
      method: "PUT",
      headers: { cookie: admin.cookie, "content-type": "application/json" },
      body: JSON.stringify({ permissions: [] }),
    });
    expect(notFound.status).toBe(404);
  } finally {
    await db.update(roles).set({ permissions: orig }).where(eq(roles.name, "system_user"));
  }
});

test("permissions endpoint lists the permission catalog", async () => {
  const user = await signup("roles-cat@test.dev");
  const res = await exports.default.fetch("http://localhost/api/v1/permissions", {
    headers: { cookie: user.cookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { permissions: string[] };
  expect(body.permissions).toContain("create_team");
});

test("me returns system permissions including create_team", async () => {
  const user = await signup("roles-me@test.dev");
  const res = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie: user.cookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { user: { permissions?: string[] } };
  expect(body.user.permissions).toContain("create_team");
});
