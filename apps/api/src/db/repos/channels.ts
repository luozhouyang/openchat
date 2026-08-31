import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "../client.ts";
import { channels, channelMembers } from "../schema-d1.ts";

type Db = ReturnType<typeof getDb>;

export async function createChannel(
  db: Db,
  row: {
    id: string;
    teamId: string | null;
    name: string | null;
    displayName: string;
    type: string;
    dedupKey: string | null;
    creatorId: string | null;
  },
) {
  const now = Date.now();
  await db.insert(channels).values({ ...row, createdAt: now });
  if (row.creatorId) {
    await db
      .insert(channelMembers)
      .values({ channelId: row.id, userId: row.creatorId, roles: "channel_admin", joinedAt: now });
  }
  return getChannel(db, row.id);
}

export async function getChannel(db: Db, channelId: string) {
  return (await db.select().from(channels).where(eq(channels.id, channelId)).limit(1))[0] ?? null;
}

export async function getChannelByDedupKey(db: Db, key: string) {
  return (await db.select().from(channels).where(eq(channels.dedupKey, key)).limit(1))[0] ?? null;
}

export async function listChannelsForTeam(db: Db, teamId: string) {
  return db.select().from(channels).where(eq(channels.teamId, teamId));
}

export async function listChannelsForUser(db: Db, userId: string) {
  return db
    .select({ channel: channels })
    .from(channelMembers)
    .innerJoin(channels, eq(channels.id, channelMembers.channelId))
    .where(eq(channelMembers.userId, userId));
}

export async function getChannelMember(db: Db, channelId: string, userId: string) {
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

export async function addChannelMember(
  db: Db,
  row: { channelId: string; userId: string; roles: string },
) {
  await db.insert(channelMembers).values({ ...row, joinedAt: Date.now() });
}

export async function removeChannelMember(db: Db, channelId: string, userId: string) {
  await db
    .delete(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)));
}

export async function listChannelMemberIds(db: Db, channelId: string) {
  const rows = await db
    .select({ userId: channelMembers.userId })
    .from(channelMembers)
    .where(eq(channelMembers.channelId, channelId));
  return rows.map((r) => r.userId);
}

export async function listChannelsByIds(db: Db, ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(channels).where(inArray(channels.id, ids));
}
