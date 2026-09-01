import { expect, test } from "vite-plus/test";
import { NodeSqliteDriver, type SqliteDriver } from "../src/db/driver.ts";
import { MIGRATIONS, SCHEMA_V1 } from "../src/db/schema.ts";
import { MIGRATIONS_TABLE, runMigrations, wipeDatabase } from "../src/db/migrations.ts";
import { createSqliteDatabase } from "../src/db/database.ts";
import { makeMessage } from "./fixtures.ts";

function makeDriver(): SqliteDriver {
  return new NodeSqliteDriver(":memory:");
}

async function appliedVersion(d: SqliteDriver): Promise<number> {
  const row = await d.get<{ v: number }>(
    `SELECT COALESCE(MAX(version), 0) AS v FROM ${MIGRATIONS_TABLE}`,
  );
  return row?.v ?? 0;
}

async function objectExists(d: SqliteDriver, name: string): Promise<boolean> {
  const row = await d.get<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?", [
    name,
  ]);
  return (row?.n ?? 0) > 0;
}

test("fresh database applies all migrations in order", async () => {
  const d = makeDriver();
  await runMigrations(d, MIGRATIONS);
  expect(await appliedVersion(d)).toBe(MIGRATIONS.length);
  expect(await objectExists(d, "messages")).toBe(true);
  expect(await objectExists(d, "idx_messages_id")).toBe(true);
  expect(await objectExists(d, "idx_messages_thread")).toBe(true);
});

test("upgrade path: v1 database with data migrates in place, rows preserved", async () => {
  const d = makeDriver();
  // Simulate a database created by an older build: schema v1 + ledger row 1.
  await d.exec(SCHEMA_V1);
  await d.exec(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`,
  );
  await d.run(`INSERT INTO ${MIGRATIONS_TABLE} VALUES (1, '0001_init_messages', 0)`);
  await d.run(
    "INSERT INTO messages (channel_id, seq, message_id, user_id, parent_id, type, content, attachments, mentions, edited_at, deleted_at, created_at) VALUES ('c1', 1, 'm1', 'u1', NULL, 'text', 'old', NULL, NULL, NULL, NULL, 1)",
  );
  expect(await objectExists(d, "idx_messages_thread")).toBe(false); // v2 not applied yet

  const db = createSqliteDatabase(d);
  await db.migrate();

  expect(await appliedVersion(d)).toBe(MIGRATIONS.length);
  expect(await objectExists(d, "idx_messages_thread")).toBe(true);
  const { rows } = await db.messages.query("c1", { limit: 10 });
  expect(rows).toHaveLength(1); // pre-upgrade data preserved
  expect(rows[0].content).toBe("old");
});

test("future-version database is wiped and rebuilt (cache semantics)", async () => {
  const d = makeDriver();
  await runMigrations(d, MIGRATIONS);
  await d.run(
    `INSERT INTO messages VALUES ('c1', 1, 'm1', 'u1', NULL, 'text', 'x', NULL, NULL, NULL, NULL, 1)`,
  );
  // Simulate a newer build having migrated further.
  await d.run(`INSERT INTO ${MIGRATIONS_TABLE} VALUES (99, '0099_future', 0)`);
  await d.exec("CREATE TABLE future_only (id TEXT)");

  const db = createSqliteDatabase(d);
  await db.migrate();

  expect(await appliedVersion(d)).toBe(MIGRATIONS.length); // rebuilt at latest known
  expect(await objectExists(d, "future_only")).toBe(false); // unknown schema wiped
  expect(await db.messages.maxSeq("c1")).toBe(0); // data gone — it is a cache
});

test("a failing migration rolls back its DDL and records nothing", async () => {
  const d = makeDriver();
  await d.exec(SCHEMA_V1);
  await d.exec(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`,
  );
  await d.run(`INSERT INTO ${MIGRATIONS_TABLE} VALUES (1, '0001_init_messages', 0)`);

  await expect(
    runMigrations(d, [
      { version: 1, name: "0001_init_messages", statements: [SCHEMA_V1] },
      {
        version: 2,
        name: "0002_broken",
        statements: ["CREATE TABLE t2 (id TEXT)", "CREATE TABLE t2 (id TEXT)"], // duplicate → error
      },
    ]),
  ).rejects.toThrow();
  expect(await appliedVersion(d)).toBe(1); // ledger untouched
  expect(await objectExists(d, "t2")).toBe(false); // DDL rolled back
});

test("migrations with a TS up() hook run and record atomically", async () => {
  const d = makeDriver();
  await runMigrations(d, [
    { version: 1, name: "0001_init", statements: [SCHEMA_V1] },
    {
      version: 2,
      name: "0002_backfill",
      statements: ["CREATE TABLE IF NOT EXISTS marker (k TEXT PRIMARY KEY)"],
      up: async (driver) => {
        await driver.run("INSERT INTO marker (k) VALUES ('done')");
      },
    },
  ]);
  const row = await d.get<{ k: string }>("SELECT k FROM marker");
  expect(row?.k).toBe("done");
  expect(await appliedVersion(d)).toBe(2);
});

test("wipeDatabase drops every user object including the ledger", async () => {
  const d = makeDriver();
  await runMigrations(d, MIGRATIONS);
  await wipeDatabase(d);
  expect(await objectExists(d, "messages")).toBe(false);
  expect(await objectExists(d, MIGRATIONS_TABLE)).toBe(false);
});

test("makeMessage fixture still aligns with the message schema", async () => {
  const db = createSqliteDatabase(makeDriver());
  await db.migrate();
  await db.messages.append("c1", makeMessage(1));
  await db.messages.applyGap("c1", [makeMessage(2), makeMessage(3)]);
  expect(await db.messages.maxSeq("c1")).toBe(3);
  await db.close();
});
