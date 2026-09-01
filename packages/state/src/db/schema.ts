import type { Migration } from "./migrations.ts";

export const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS messages (
  channel_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  parent_id TEXT,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments TEXT,
  mentions TEXT,
  edited_at INTEGER,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (channel_id, seq)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_id ON messages (channel_id, message_id);
`;

/**
 * Append-only: never edit a shipped entry — corrections are new migrations.
 */
export const MIGRATIONS: Migration[] = [
  { version: 1, name: "0001_init_messages", statements: [SCHEMA_V1] },
  {
    version: 2,
    name: "0002_thread_index",
    statements: [
      // p10 spec §3.3: thread lookups by (channel_id, parent_id).
      `CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages (channel_id, parent_id);`,
    ],
  },
];
