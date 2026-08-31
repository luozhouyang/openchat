import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

export const schemaVersion = sqliteTable("schema_version", {
  version: integer("version").notNull(),
  appliedAt: text("applied_at").notNull(),
});

export const messages = sqliteTable(
  "messages",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    id: text("id").notNull().unique(),
    userId: text("user_id").notNull(),
    parentId: text("parent_id"),
    type: text("type").notNull().default("text"),
    content: text("content").notNull(),
    attachments: text("attachments"),
    fileIds: text("file_ids"),
    props: text("props"),
    hashtags: text("hashtags"),
    mentions: text("mentions"),
    isPinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
    hasReactions: integer("has_reactions", { mode: "boolean" }).notNull().default(false),
    editedAt: integer("edited_at"),
    updatedAt: integer("updated_at"),
    deletedAt: integer("deleted_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_msg_parent").on(t.parentId, t.seq), index("idx_msg_created").on(t.createdAt)],
);

export const memberState = sqliteTable("member_state", {
  userId: text("user_id").primaryKey(),
  role: text("role").notNull().default("member"),
  lastReadSeq: integer("last_read_seq").notNull().default(0),
  mentionCount: integer("mention_count").notNull().default(0),
  notifPref: text("notif_pref").notNull().default("all"),
  joinedAt: integer("joined_at").notNull(),
});

export const dedupTokens = sqliteTable(
  "dedup_tokens",
  {
    userId: text("user_id").notNull(),
    token: text("token").notNull(),
    messageSeq: integer("message_seq").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.token] })],
);

export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const reactions = sqliteTable(
  "reactions",
  {
    messageSeq: integer("message_seq").notNull(),
    emoji: text("emoji").notNull(),
    userId: text("user_id").notNull(),
    createdAt: integer("created_at").notNull(),
    updateAt: integer("update_at"),
    deleteAt: integer("delete_at"),
  },
  (t) => [primaryKey({ columns: [t.messageSeq, t.emoji, t.userId] })],
);

export const threadSubscriptions = sqliteTable(
  "thread_subscriptions",
  {
    parentId: text("parent_id").notNull(),
    userId: text("user_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.parentId, t.userId] })],
);

export const threads = sqliteTable("threads", {
  postId: text("post_id").primaryKey(),
  replyCount: integer("reply_count").notNull().default(0),
  lastReplyAt: integer("last_reply_at"),
  participants: text("participants"),
  channelId: text("channel_id"),
});

export const threadMemberships = sqliteTable(
  "thread_memberships",
  {
    postId: text("post_id").notNull(),
    userId: text("user_id").notNull(),
    following: integer("following", { mode: "boolean" }).notNull().default(true),
    lastViewed: integer("last_viewed"),
    lastUpdated: integer("last_updated"),
    unreadMentions: integer("unread_mentions").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
);
