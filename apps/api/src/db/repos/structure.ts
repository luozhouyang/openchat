import { eq, and } from "drizzle-orm";
import { getDb } from "../client.ts";
import { channelMembers } from "../schema-d1.ts";

type Db = ReturnType<typeof getDb>;

export async function getChannelMemberForSync(db: Db, channelId: string, userId: string) {
  return (
    (
      await db
        .select()
        .from(channelMembers)
        .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
        .limit(1)
    )[0] ?? null
  );
}
