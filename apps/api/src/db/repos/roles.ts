import { eq } from "drizzle-orm";
import { getDb } from "../client.ts";
import { roles, schemes } from "../schema-d1.ts";

type Db = ReturnType<typeof getDb>;

export async function listRoles(db: Db) {
  return db.select().from(roles);
}

export async function listSchemes(db: Db) {
  return db.select().from(schemes);
}

export async function getRoleByName(db: Db, name: string) {
  return (await db.select().from(roles).where(eq(roles.name, name)).limit(1))[0] ?? null;
}

export async function createRole(
  db: Db,
  row: {
    id: string;
    name: string;
    displayName: string;
    description: string | null;
    permissions: string;
    builtIn: boolean;
  },
) {
  const now = Date.now();
  await db.insert(roles).values({ ...row, createdAt: now, updatedAt: now });
  return getRoleByName(db, row.name);
}
