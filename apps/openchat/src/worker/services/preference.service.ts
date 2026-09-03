import { and, eq } from "drizzle-orm";
import { preferences } from "../db/schema-d1.ts";
import { listPreferences } from "../db/repos/preferences.ts";

type Db = import("../db/types.ts").Db;

type PreferenceItem = { category: string; name: string; value?: string };

function asBatch<T>(arr: T[]): [T, ...T[]] {
  if (arr.length === 0) throw new Error("empty batch");
  return arr as [T, ...T[]];
}

export async function getPreferences(db: Db, userId: string) {
  const rows = await listPreferences(db, userId);
  return { preferences: rows.map((r) => ({ category: r.category, name: r.name, value: r.value })) };
}

export async function setPreferences(db: Db, userId: string, items: PreferenceItem[]) {
  const stmts = items.map((item) =>
    db
      .insert(preferences)
      .values({ userId, category: item.category, name: item.name, value: item.value ?? "" })
      .onConflictDoUpdate({
        target: [preferences.userId, preferences.category, preferences.name],
        set: { value: item.value ?? "" },
      }),
  );
  if (stmts.length === 0) return { ok: true };
  await db.batch(asBatch(stmts));
  return { ok: true };
}

export async function deletePreferences(db: Db, userId: string, items: PreferenceItem[]) {
  const stmts = items.map((item) =>
    db
      .delete(preferences)
      .where(
        and(
          eq(preferences.userId, userId),
          eq(preferences.category, item.category),
          eq(preferences.name, item.name),
        ),
      ),
  );
  if (stmts.length === 0) return { ok: true };
  await db.batch(asBatch(stmts));
  return { ok: true };
}
