import { expect, test } from "vite-plus/test";
import type { Team, ChannelDoMessage } from "../../../src/worker/db/types.ts";
import { getDb } from "../../../src/worker/db/client.ts";
import { env } from "cloudflare:test";
import { teams } from "../../../src/worker/db/schema-d1.ts";
import { eq } from "drizzle-orm";

test("db/types exports row types usable with drizzle results", async () => {
  const db = getDb(env.DB);
  await db.insert(teams).values({
    id: "type-team-1",
    name: "type-team-1",
    displayName: "Types",
    type: "open",
    creatorId: "user-type-1",
    createdAt: Date.now(),
  });
  const rows = await db.select().from(teams).where(eq(teams.id, "type-team-1")).limit(1);
  const row: Team = rows[0];
  expect(row.displayName).toBe("Types");
  const msg: ChannelDoMessage = {
    seq: 1,
    id: "m1",
    userId: "u1",
    parentId: null,
    type: "text",
    content: "hi",
    attachments: null,
    fileIds: null,
    props: null,
    hashtags: null,
    mentions: null,
    isPinned: false,
    hasReactions: false,
    editedAt: null,
    updatedAt: null,
    deletedAt: null,
    createdAt: Date.now(),
  };
  expect(msg.type).toBe("text");
});
