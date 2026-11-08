import { env } from "cloudflare:workers";
import { expect, test } from "vite-plus/test";
import { runInDurableObject, evictDurableObject } from "cloudflare:test";
import userMigrations from "../../../migrations/user-do/migrations";
import channelMigrations from "../../../migrations/channel-do/migrations";

// Final schema expected after all migrations for each DO. `schema_version` is
// legacy (created by 0000_init); the migrator additionally maintains the
// `__drizzle_migrations` journal table. Asserting each table and its columns
// is the strongest guarantee that every migration ran — a partially-applied
// migration would leave tables/columns missing.
const USER_DO_TABLES: Record<string, string[]> = {
  channels_cache: ["channel_id"],
  push_subscriptions: ["device_id", "kind", "endpoint", "p256dh", "auth", "updated_at"],
  sidebar_cache: [
    "channel_id",
    "max_seq",
    "last_message_preview",
    "last_message_user_id",
    "last_message_at",
    "last_read_seq",
    "mention_count",
    "updated_at",
  ],
  sidebarcategories: [
    "id",
    "user_id",
    "team_id",
    "sort_order",
    "sorting",
    "type",
    "display_name",
    "muted",
    "collapsed",
  ],
  sidebarchannels: ["channel_id", "user_id", "category_id", "sort_order"],
  schema_version: ["version", "applied_at"],
};

const CHANNEL_DO_TABLES: Record<string, string[]> = {
  dedup_tokens: ["user_id", "token", "message_seq", "created_at"],
  member_state: [
    "user_id",
    "role",
    "last_read_seq",
    "mention_count",
    "notif_pref",
    "push_subscribed",
    "joined_at",
  ],
  messages: [
    "seq",
    "id",
    "user_id",
    "parent_id",
    "type",
    "content",
    "attachments",
    "file_ids",
    "props",
    "hashtags",
    "mentions",
    "is_pinned",
    "has_reactions",
    "edited_at",
    "updated_at",
    "deleted_at",
    "created_at",
  ],
  meta: ["key", "value"],
  reactions: ["message_seq", "emoji", "user_id", "created_at", "update_at", "delete_at"],
  thread_subscriptions: ["parent_id", "user_id"],
  thread_memberships: [
    "post_id",
    "user_id",
    "following",
    "last_viewed",
    "last_updated",
    "unread_mentions",
  ],
  threads: ["post_id", "reply_count", "last_reply_at", "participants", "channel_id"],
  schema_version: ["version", "applied_at"],
};

let serial = 0;

/** Fresh, never-used DO instance so migrations run against empty storage. */
function freshUserStub() {
  serial += 1;
  return env.USER_DO.get(env.USER_DO.idFromName(`migrations-user-${serial}-${Date.now()}`));
}

function freshChannelStub() {
  serial += 1;
  return env.CHANNEL_DO.get(
    env.CHANNEL_DO.idFromName(`migrations-channel-${serial}-${Date.now()}`),
  );
}

/** `SELECT * FROM <table> LIMIT 0` for every table; returns the ones that throw. */
async function unqueryableTables(stub: DurableObjectStub, tables: string[]): Promise<string[]> {
  return runInDurableObject(stub, (_instance, state) => {
    const sql = state.storage.sql;
    const failed: string[] = [];
    for (const table of tables) {
      try {
        sql.exec(`SELECT * FROM ${table} LIMIT 0`).toArray();
      } catch {
        failed.push(table);
      }
    }
    return failed;
  });
}

interface DoSchema {
  columns: Record<string, string[]>;
  migrationCount: number;
}

async function readSchema(stub: DurableObjectStub): Promise<DoSchema> {
  return runInDurableObject(stub, (_instance, state) => {
    const sql = state.storage.sql;
    const tables = sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .toArray()
      .map((r) => String(r.name));
    // Skip Cloudflare-internal tables: scheduling an alarm materializes the
    // `_cf_METADATA` row in sqlite_master, and PRAGMA on internal tables is
    // always "not authorized: SQLITE_AUTH" — they are not ours to assert.
    const internalTables = (name: string) => name === "_cf_METADATA" || name.startsWith("sqlite_");
    const columns: Record<string, string[]> = {};
    for (const table of tables.filter((t) => !internalTables(t))) {
      columns[table] = sql
        .exec(`PRAGMA table_info(${table})`)
        .toArray()
        .map((r) => String(r.name));
    }
    const rows = sql.exec("SELECT COUNT(*) AS n FROM __drizzle_migrations").toArray();
    return { columns, migrationCount: Number(rows[0]?.n ?? 0) };
  });
}

test("a fresh UserDO instance runs all migrations", async () => {
  const stub = freshUserStub();
  expect(await unqueryableTables(stub, Object.keys(USER_DO_TABLES))).toEqual([]);

  const schema = await readSchema(stub);
  for (const [table, cols] of Object.entries(USER_DO_TABLES)) {
    expect(schema.columns[table]).toEqual(expect.arrayContaining(cols));
  }
  expect(schema.migrationCount).toBe(userMigrations.journal.entries.length);
});

test("a fresh ChannelDO instance runs all migrations", async () => {
  const stub = freshChannelStub();
  expect(await unqueryableTables(stub, Object.keys(CHANNEL_DO_TABLES))).toEqual([]);

  const schema = await readSchema(stub);
  for (const [table, cols] of Object.entries(CHANNEL_DO_TABLES)) {
    expect(schema.columns[table]).toEqual(expect.arrayContaining(cols));
  }
  expect(schema.migrationCount).toBe(channelMigrations.journal.entries.length);
});

test("re-running migrations after eviction is idempotent", async () => {
  const stub = freshChannelStub();
  const first = (await readSchema(stub)).migrationCount;
  expect(first).toBe(channelMigrations.journal.entries.length);

  await evictDurableObject(stub);
  const second = (await readSchema(stub)).migrationCount;

  expect(second).toBe(first);
});
