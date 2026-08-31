import { expect, test } from "vite-plus/test";
import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { getDb } from "../../src/db/client.ts";

test("structure tables exist after migration", async () => {
  const db = getDb(env.DB);
  const rows = await db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type='table'`,
  );
  const names = rows.map((r) => r.name);
  for (const table of [
    "teams",
    "team_members",
    "channels",
    "channel_members",
    "integrations",
    "system_settings",
    "preferences",
    "roles",
    "schemes",
    "uploadsessions",
    "fileinfo",
  ]) {
    expect(names).toContain(table);
  }
});
