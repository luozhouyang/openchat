import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

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
  description: text("description"),
  email: text("email"),
  companyName: text("company_name"),
  allowedDomains: text("allowed_domains"),
  schemeId: text("scheme_id"),
  groupConstrained: integer("group_constrained", { mode: "boolean" }).default(false),
  updatedAt: integer("updated_at"),
});

export const teamMembers = sqliteTable(
  "team_members",
  {
    teamId: text("team_id").notNull(),
    userId: text("user_id").notNull(),
    roles: text("roles").notNull().default("team_user"),
    joinedAt: integer("joined_at").notNull(),
    deleteAt: integer("delete_at"),
    schemeUser: integer("scheme_user", { mode: "boolean" }).default(false),
    schemeAdmin: integer("scheme_admin", { mode: "boolean" }).default(false),
    schemeGuest: integer("scheme_guest", { mode: "boolean" }).default(false),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.userId] }),
    index("idx_tm_user").on(t.userId),
    index("idx_tm_team").on(t.teamId),
  ],
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
    header: text("header"),
    purpose: text("purpose"),
    lastPostAt: integer("last_post_at"),
    totalMsgCount: integer("total_msg_count").default(0),
    totalMsgCountRoot: integer("total_msg_count_root").default(0),
    lastRootPostAt: integer("last_root_post_at"),
    extraUpdateAt: integer("extra_update_at"),
    schemeId: text("scheme_id"),
    shared: integer("shared", { mode: "boolean" }).default(false),
    groupConstrained: integer("group_constrained", { mode: "boolean" }).default(false),
    updatedAt: integer("updated_at"),
  },
  (t) => [
    uniqueIndex("uq_channel_team_name").on(t.teamId, t.name),
    uniqueIndex("uq_channel_dedup").on(t.dedupKey),
    index("idx_channel_team").on(t.teamId),
  ],
);

export const channelMembers = sqliteTable(
  "channel_members",
  {
    channelId: text("channel_id").notNull(),
    userId: text("user_id").notNull(),
    roles: text("roles").notNull().default("channel_user"),
    joinedAt: integer("joined_at").notNull(),
    lastViewedAt: integer("last_viewed_at"),
    msgCount: integer("msg_count").default(0),
    msgCountRoot: integer("msg_count_root").default(0),
    mentionCount: integer("mention_count").default(0),
    mentionCountRoot: integer("mention_count_root").default(0),
    notifyProps: text("notify_props"),
    lastUpdateAt: integer("last_update_at"),
    schemeUser: integer("scheme_user", { mode: "boolean" }).default(false),
    schemeAdmin: integer("scheme_admin", { mode: "boolean" }).default(false),
    schemeGuest: integer("scheme_guest", { mode: "boolean" }).default(false),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.userId] }),
    index("idx_cm_user").on(t.userId),
    index("idx_cm_channel").on(t.channelId),
  ],
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

export const uploadsessions = sqliteTable(
  "uploadsessions",
  {
    id: text("id").primaryKey(),
    type: text("type"),
    createdAt: integer("created_at"),
    userId: text("user_id"),
    channelId: text("channel_id"),
    filename: text("filename"),
    path: text("path"),
    fileSize: integer("file_size"),
    fileOffset: integer("file_offset").default(0),
    reqFileId: text("req_file_id"),
  },
  (t) => [
    index("idx_upl_user").on(t.userId),
    index("idx_upl_channel").on(t.channelId),
    index("idx_upl_create").on(t.createdAt),
  ],
);

export const fileinfo = sqliteTable(
  "fileinfo",
  {
    id: text("id").primaryKey(),
    creatorId: text("creator_id"),
    postId: text("post_id"),
    createdAt: integer("created_at"),
    updatedAt: integer("updated_at"),
    deletedAt: integer("deleted_at"),
    path: text("path"),
    thumbnailPath: text("thumbnail_path"),
    previewPath: text("preview_path"),
    name: text("name"),
    extension: text("extension"),
    size: integer("size"),
    mimeType: text("mime_type"),
    width: integer("width"),
    height: integer("height"),
    hasPreviewImage: integer("has_preview_image", { mode: "boolean" }),
    miniPreview: text("mini_preview"),
    content: text("content"),
  },
  (t) => [index("idx_fi_post").on(t.postId), index("idx_fi_creator").on(t.creatorId)],
);

export const invites = sqliteTable("invites", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  email: text("email").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  consumedAt: integer("consumed_at"),
  revokedAt: integer("revoked_at"),
  acceptedBy: text("accepted_by"),
});

export const preferences = sqliteTable(
  "preferences",
  {
    userId: text("user_id").notNull(),
    category: text("category").notNull(),
    name: text("name").notNull(),
    value: text("value").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.category, t.name] }),
    index("idx_pref_category").on(t.category),
    index("idx_pref_user").on(t.userId),
  ],
);

export const roles = sqliteTable("roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  permissions: text("permissions").notNull(),
  builtIn: integer("built_in", { mode: "boolean" }).default(false),
  createdAt: integer("created_at"),
  updatedAt: integer("updated_at"),
  deletedAt: integer("deleted_at"),
});

export const schemes = sqliteTable("schemes", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  scope: text("scope").notNull(),
  defaultTeamAdminRole: text("default_team_admin_role"),
  defaultTeamUserRole: text("default_team_user_role"),
  defaultChannelAdminRole: text("default_channel_admin_role"),
  defaultChannelUserRole: text("default_channel_user_role"),
  createdAt: integer("created_at"),
  updatedAt: integer("updated_at"),
  deletedAt: integer("deleted_at"),
});
