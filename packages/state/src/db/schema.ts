export const SCHEMA = `
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

export const MIGRATIONS: string[] = [
  SCHEMA,
  // v2 (p10 spec §3.3): thread lookups by (channel_id, parent_id).
  `CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages (channel_id, parent_id);`,
];
