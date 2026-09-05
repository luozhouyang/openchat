import { env } from "cloudflare:workers";
import { expect, test } from "vite-plus/test";
import { getDb } from "@worker/db/client";
import { listRoles, getRoleByName, createRole } from "@worker/db/repos/roles";

const db = getDb(env.DB);

test("createRole then getRoleByName returns the role", async () => {
  const role = await createRole(db, {
    id: "role-custom-1",
    name: "custom",
    displayName: "Custom",
    description: "a custom role",
    permissions: JSON.stringify(["read", "write"]),
    builtIn: false,
  });
  expect(role?.name).toBe("custom");
  expect(role?.displayName).toBe("Custom");

  const fetched = await getRoleByName(db, "custom");
  expect(fetched?.permissions).toBe(JSON.stringify(["read", "write"]));
  expect(fetched?.builtIn).toBe(false);
});

test("listRoles returns created roles", async () => {
  await createRole(db, {
    id: "role-custom-2",
    name: "moderator",
    displayName: "Moderator",
    description: null,
    permissions: "[]",
    builtIn: true,
  });
  const rows = await listRoles(db);
  expect(rows.map((r) => r.name)).toContain("moderator");
});

test("getRoleByName returns null for missing role", async () => {
  expect(await getRoleByName(db, "does-not-exist")).toBeNull();
});
