import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

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

export const presenceSubscribers = sqliteTable("presence_subscribers", {
  userId: text("user_id").primaryKey(),
  expiresAt: integer("expires_at").notNull(),
});

export const presenceSubscriptions = sqliteTable("presence_subscriptions", {
  userId: text("user_id").primaryKey(),
  expiresAt: integer("expires_at").notNull(),
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
