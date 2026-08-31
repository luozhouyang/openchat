import { eq, and } from "drizzle-orm";
import { getDb } from "../client.ts";
import { preferences } from "../schema-d1.ts";

type Db = ReturnType<typeof getDb>;

export async function getPreference(
  db: Db,
  row: { userId: string; category: string; name: string },
) {
  return (
    (
      await db
        .select()
        .from(preferences)
        .where(
          and(
            eq(preferences.userId, row.userId),
            eq(preferences.category, row.category),
            eq(preferences.name, row.name),
          ),
        )
        .limit(1)
    )[0] ?? null
  );
}

export async function setPreference(
  db: Db,
  row: { userId: string; category: string; name: string; value: string },
) {
  await db
    .insert(preferences)
    .values(row)
    .onConflictDoUpdate({
      target: [preferences.userId, preferences.category, preferences.name],
      set: { value: row.value },
    });
}

export async function listPreferences(db: Db, userId: string) {
  return db.select().from(preferences).where(eq(preferences.userId, userId));
}

export async function deletePreference(
  db: Db,
  row: { userId: string; category: string; name: string },
) {
  await db
    .delete(preferences)
    .where(
      and(
        eq(preferences.userId, row.userId),
        eq(preferences.category, row.category),
        eq(preferences.name, row.name),
      ),
    );
}
