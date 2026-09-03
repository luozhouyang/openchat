import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

export const schemaVersion = sqliteTable("schema_version", {
  version: integer("version").notNull(),
  appliedAt: text("applied_at").notNull(),
});

export const channelsCache = sqliteTable("channels_cache", {
  channelId: text("channel_id").primaryKey(),
});

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  deviceId: text("device_id").primaryKey(),
  kind: text("kind").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh"),
  auth: text("auth"),
  updatedAt: integer("updated_at").notNull(),
});

export const sidebarCache = sqliteTable("sidebar_cache", {
  channelId: text("channel_id").primaryKey(),
  maxSeq: integer("max_seq").notNull().default(0),
  lastMessagePreview: text("last_message_preview"),
  lastMessageUserId: text("last_message_user_id"),
  lastMessageAt: integer("last_message_at"),
  lastReadSeq: integer("last_read_seq").notNull().default(0),
  mentionCount: integer("mention_count").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const sidebarcategories = sqliteTable("sidebarcategories", {
  id: text("id", { length: 128 }).primaryKey(),
  userId: text("user_id").notNull(),
  teamId: text("team_id"),
  sortOrder: integer("sort_order"),
  sorting: text("sorting"),
  type: text("type"),
  displayName: text("display_name"),
  muted: integer("muted", { mode: "boolean" }).notNull().default(false),
  collapsed: integer("collapsed", { mode: "boolean" }).notNull().default(false),
});

export const sidebarchannels = sqliteTable(
  "sidebarchannels",
  {
    channelId: text("channel_id").notNull(),
    userId: text("user_id").notNull(),
    categoryId: text("category_id").notNull(),
    sortOrder: integer("sort_order"),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.userId, t.categoryId] }),
    index("idx_sbc_user").on(t.userId),
  ],
);
