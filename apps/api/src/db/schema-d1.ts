export * from "./schema-auth.ts";

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  type: text("type").notNull().default("open"),
  creatorId: text("creator_id").notNull(),
  createdAt: integer("created_at").notNull(),
});
