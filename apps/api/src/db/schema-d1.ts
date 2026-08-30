import { sqliteTable, text, integer, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";

export * from "./schema-auth.ts";

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  type: text("type").notNull().default("open"),
  inviteCode: text("invite_code"),
  archivedAt: integer("archived_at"),
  creatorId: text("creator_id").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const teamMembers = sqliteTable(
  "team_members",
  {
    teamId: text("team_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull().default("member"),
    joinedAt: integer("joined_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

export const channels = sqliteTable(
  "channels",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id"),
    name: text("name"),
    displayName: text("display_name").notNull(),
    type: text("type").notNull(),
    dedupKey: text("dedup_key"),
    archivedAt: integer("archived_at"),
    creatorId: text("creator_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_channel_team_name").on(t.teamId, t.name),
    uniqueIndex("uq_channel_dedup").on(t.dedupKey),
  ],
);

export const channelMembers = sqliteTable(
  "channel_members",
  {
    channelId: text("channel_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull().default("member"),
    joinedAt: integer("joined_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.userId] })],
);

export const integrations = sqliteTable("integrations", {
  id: text("id").primaryKey(),
  teamId: text("team_id"),
  type: text("type").notNull(),
  trigger: text("trigger"),
  endpointUrl: text("endpoint_url"),
  secret: text("secret"),
  creatorId: text("creator_id"),
});

export const systemSettings = sqliteTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const uploads = sqliteTable("uploads", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull(),
  userId: text("user_id").notNull(),
  key: text("key").notNull(),
  filename: text("filename").notNull(),
  size: integer("size").notNull(),
  contentType: text("content_type").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
});
