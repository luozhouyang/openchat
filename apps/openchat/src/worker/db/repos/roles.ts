import { eq } from "drizzle-orm";
import type { Role, RoleInsert, Db } from "@worker/db/types";
import { roles, schemes } from "@worker/db/schema-d1";

export async function listRoles(db: Db): Promise<Role[]> {
  return db.select().from(roles);
}

export async function listSchemes(db: Db) {
  return db.select().from(schemes);
}

export async function getRoleByName(db: Db, name: string): Promise<Role | null> {
  const rows = await db.select().from(roles).where(eq(roles.name, name)).limit(1);
  return rows[0] ?? null;
}

export async function createRole(db: Db, row: RoleInsert): Promise<Role | null> {
  const now = Date.now();
  await db.insert(roles).values({ ...row, createdAt: now, updatedAt: now });
  return getRoleByName(db, row.name);
}

export async function updateRolePermissions(
  db: Db,
  roleId: string,
  permissions: string[],
): Promise<Role | null> {
  await db
    .update(roles)
    .set({ permissions: JSON.stringify(permissions), updatedAt: Date.now() })
    .where(eq(roles.id, roleId));
  const rows = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  return rows[0] ?? null;
}
