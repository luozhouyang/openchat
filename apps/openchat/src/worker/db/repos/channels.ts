import { eq, and, inArray } from "drizzle-orm";
import type {
  Channel,
  ChannelInsert,
  ChannelMember,
  ChannelMemberInsert,
  Db,
} from "@worker/db/types";
import { channels, channelMembers, users } from "@worker/db/schema-d1";

export async function createChannel(
  db: Db,
  row: Omit<ChannelInsert, "createdAt"> & { createdAt?: number },
) {
  await db.insert(channels).values({ ...row, createdAt: row.createdAt ?? Date.now() });
  if (row.creatorId) {
    await db.insert(channelMembers).values({
      channelId: row.id,
      userId: row.creatorId,
      roles: "channel_admin",
      joinedAt: Date.now(),
    });
  }
  return getChannel(db, row.id);
}

export async function updateChannel(
  db: Db,
  input: {
    channelId: string;
    displayName?: string;
    purpose?: string | null;
    header?: string | null;
  },
): Promise<Channel | null> {
  const patch: Partial<typeof channels.$inferInsert> = {};
  if (input.displayName !== undefined) {
    patch.displayName = input.displayName;
  }
  if (input.purpose !== undefined) {
    patch.purpose = input.purpose;
  }
  if (input.header !== undefined) {
    patch.header = input.header;
  }
  if (Object.keys(patch).length > 0) {
    await db.update(channels).set(patch).where(eq(channels.id, input.channelId));
  }
  return getChannel(db, input.channelId);
}

export async function getChannel(db: Db, channelId: string): Promise<Channel | null> {
  const rows = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  return rows[0] ?? null;
}

export async function getChannelByDedupKey(db: Db, key: string): Promise<Channel | null> {
  const rows = await db.select().from(channels).where(eq(channels.dedupKey, key)).limit(1);
  return rows[0] ?? null;
}

export async function listChannelsForTeam(db: Db, teamId: string): Promise<Channel[]> {
  return db.select().from(channels).where(eq(channels.teamId, teamId));
}

/** One query for a set of teams (workspaces endpoint replaces the N×1 scan). */
export async function listChannelsForTeams(db: Db, teamIds: string[]): Promise<Channel[]> {
  if (teamIds.length === 0) {
    return [];
  }
  return db.select().from(channels).where(inArray(channels.teamId, teamIds));
}

export interface ChannelMemberWithName {
  channelId: string;
  userId: string;
  nickname: string | null;
  name: string | null;
  email: string | null;
}

/**
 * One JOIN for the member list (plus display-name source columns) of many
 * channels — replaces the per-DM/GM `listChannelMemberIds` + `memberNames`
 * double round trip on hot read paths. Rows come in channel_members order;
 * group by channelId client-side. `email` is only a display fallback here,
 * never returned to the client (see the reaction of user-search on email).
 */
export async function listChannelMembersWithNames(
  db: Db,
  channelIds: string[],
): Promise<ChannelMemberWithName[]> {
  if (channelIds.length === 0) {
    return [];
  }
  return db
    .select({
      channelId: channelMembers.channelId,
      userId: channelMembers.userId,
      nickname: users.nickname,
      name: users.name,
      email: users.email,
    })
    .from(channelMembers)
    .innerJoin(users, eq(users.id, channelMembers.userId))
    .where(inArray(channelMembers.channelId, channelIds));
}

export async function listChannelsForUser(db: Db, userId: string) {
  return db
    .select({ channel: channels })
    .from(channelMembers)
    .innerJoin(channels, eq(channels.id, channelMembers.channelId))
    .where(eq(channelMembers.userId, userId));
}

export async function getChannelMember(
  db: Db,
  channelId: string,
  userId: string,
): Promise<ChannelMember | null> {
  const rows = await db
    .select()
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function addChannelMember(db: Db, row: Omit<ChannelMemberInsert, "joinedAt">) {
  await db.insert(channelMembers).values({ ...row, joinedAt: Date.now() });
}

export async function removeChannelMember(db: Db, channelId: string, userId: string) {
  await db
    .delete(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)));
}

export async function listChannelMemberIds(db: Db, channelId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: channelMembers.userId })
    .from(channelMembers)
    .where(eq(channelMembers.channelId, channelId));
  return rows.map((r) => r.userId);
}

export async function listChannelsByIds(db: Db, ids: string[]): Promise<Channel[]> {
  if (ids.length === 0) {
    return [];
  }
  return db.select().from(channels).where(inArray(channels.id, ids));
}
