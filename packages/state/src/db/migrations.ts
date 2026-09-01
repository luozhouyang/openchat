import type { SqliteDriver } from "./driver.ts";

/**
 * Versioned, append-only schema migrations recorded in a dedicated table
 * (mirrors the server-side drizzle migrator convention). Invariants:
 *  1. the version INSERT and the DDL run in ONE transaction;
 *  2. shipped migrations are never edited — corrections are new migrations;
 *  3. a database from a newer build (MAX(version) > known) is wiped and
 *     rebuilt: the local database is a cache of server truth;
 *  4. every upgrade path is covered by tests (see test/migrations.test.ts).
 */
export interface Migration {
  /** Contiguous integers (1, 2, 3, …) — never timestamp strings. */
  version: number;
  /** e.g. "0002_thread_index" */
  name: string;
  /** Kept idempotent (IF NOT EXISTS) as defense in depth. */
  statements: string[];
  /** Data backfills and other TS-side transform logic. */
  up?: (d: SqliteDriver) => Promise<void>;
}

export const MIGRATIONS_TABLE = "__openchat_migrations";

const BOOTSTRAP = `
CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
)`;

async function appliedVersion(d: SqliteDriver): Promise<number> {
  const row = await d.get<{ v: number }>(
    `SELECT COALESCE(MAX(version), 0) AS v FROM ${MIGRATIONS_TABLE}`,
  );
  return row?.v ?? 0;
}

/**
 * Drops every user object (table/index/view/trigger) in the file, including
 * the migrations ledger itself — used for the future-version wipe policy.
 */
export async function wipeDatabase(d: SqliteDriver): Promise<void> {
  const rows = await d.all<{ name: string; type: string }>(
    "SELECT name, type FROM sqlite_master WHERE type IN ('table','index','view','trigger') AND name NOT LIKE 'sqlite_%'",
  );
  await d.exec("BEGIN");
  try {
    for (const r of rows) {
      await d.exec(`DROP ${r.type.toUpperCase()} IF EXISTS "${r.name}"`);
    }
    await d.exec("COMMIT");
  } catch (err) {
    await d.exec("ROLLBACK").catch(() => {});
    throw err;
  }
}

export async function runMigrations(d: SqliteDriver, list: Migration[]): Promise<void> {
  await d.exec(BOOTSTRAP);
  let current = await appliedVersion(d);

  if (current > list.length) {
    // Database written by a newer build (app downgrade). The local database
    // is a disposable cache of server truth: wipe and rebuild from scratch.
    await wipeDatabase(d);
    await d.exec(BOOTSTRAP);
    current = 0;
  }

  for (const m of list) {
    if (m.version <= current) continue;
    await d.exec("BEGIN");
    try {
      for (const sql of m.statements) await d.exec(sql);
      if (m.up) await m.up(d);
      await d.run(`INSERT INTO ${MIGRATIONS_TABLE} (version, name, applied_at) VALUES (?, ?, ?)`, [
        m.version,
        m.name,
        Date.now(),
      ]);
      await d.exec("COMMIT");
    } catch (err) {
      await d.exec("ROLLBACK").catch(() => {});
      throw err;
    }
  }
}
