import { and, eq } from "drizzle-orm";
import { id, type ChannelType } from "protocol";
import { channels, channelMembers } from "@worker/db/schema-d1";
import type { Db } from "@worker/db/types";
import {
  getChannel,
  getChannelByDedupKey,
  getChannelMember,
  addChannelMember,
  removeChannelMember,
} from "@worker/db/repos/channels";
import { getTeamMember } from "@worker/db/repos/teams";
import { apiError } from "@worker/lib/errors";

type Channel = typeof channels.$inferSelect;

export async function dedupKeyFor(kind: ChannelType, ids: string[]): Promise<string> {
  const sorted = [...ids].sort();
  const data = new TextEncoder().encode(`${kind}:${sorted.join(",")}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${kind}:${hex}`;
}

/**
 * Unique-index race on `channels.dedup_key` (uq_channel_dedup): two concurrent
 * opens of the same pair used to end in an uncaught 500. On insert failure
 * re-read the channel by dedup key and degrade to the idempotent
 * `existing: true` response; a non-dedup failure is rethrown untouched (the
 * batch is transactional, so no partial rows survive).
 */

export async function createChannel(
  db: Db,
  input: {
    teamId: string;
    name?: string;
    displayName: string;
    type: "public" | "private";
    purpose?: string;
    header?: string;
    creatorId: string;
  },
): Promise<Channel> {
  const channelId = id("chn");
  const now = Date.now();
  // D1 has no transactional interface — the only atomicity primitive is
  // `db.batch`. The channel row and its creator membership therefore go into
  // one batch (all-or-nothing), instead of the previous two sequential writes
  // that could strand a channel with no membership.
  if (input.name) {
    // Pre-check (teamId, name) uniqueness so the documented 409 wording is kept
    // without having to translate a mid-batch constraint failure.
    const existing = await db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.teamId, input.teamId), eq(channels.name, input.name)))
      .limit(1);
    if (existing[0]) {
      throw apiError("name_taken", "name taken", 409);
    }
  }
  const inserts = [
    db
      .insert(channels)
      .values({
        id: channelId,
        teamId: input.teamId,
        name: input.name ?? null,
        displayName: input.displayName,
        type: input.type,
        dedupKey: null,
        purpose: input.purpose ?? null,
        header: input.header ?? null,
        creatorId: input.creatorId,
        createdAt: now,
      })
      .onConflictDoNothing(),
    db.insert(channelMembers).values({
      channelId,
      userId: input.creatorId,
      roles: "channel_admin",
      joinedAt: now,
    }),
  ];
  try {
    await db.batch(inserts as [(typeof inserts)[number], ...(typeof inserts)[number][]]);
  } catch (err) {
    // Race window: name taken between pre-check and batch. The batch rolls
    // back atomically, so re-reading decides between conflict and real error.
    const stillThere = input.name
      ? await db
          .select({ id: channels.id })
          .from(channels)
          .where(and(eq(channels.teamId, input.teamId), eq(channels.name, input.name)))
          .limit(1)
      : [];
    if (stillThere[0]) {
      throw apiError("name_taken", "name taken", 409);
    }
    throw err;
  }
  const ch = await getChannel(db, channelId);
  if (!ch) {
    throw apiError("name_taken", "name taken", 409);
  }
  return ch;
}

export async function openDirect(
  db: Db,
  input: { userId: string; withUserId: string },
): Promise<{ id: string; existing: boolean }> {
  const ids = [input.userId, input.withUserId];
  const key = await dedupKeyFor("dm", ids);
  const existing = await getChannelByDedupKey(db, key);
  if (existing) {
    return { id: existing.id, existing: true };
  }
  const channelId = id("chn");
  const now = Date.now();
  const inserts = [
    db.insert(channels).values({
      id: channelId,
      teamId: null,
      name: null,
      displayName: "dm",
      type: "dm",
      dedupKey: key,
      creatorId: null,
      createdAt: now,
    }),
    ...ids.map((userId) =>
      db.insert(channelMembers).values({ channelId, userId, roles: "channel_user", joinedAt: now }),
    ),
  ];
  try {
    await db.batch(inserts as [(typeof inserts)[number], ...(typeof inserts)[number][]]);
  } catch (err) {
    // Dedup-key race (uq_channel_dedup): another request opened the same pair
    // first — degrade to the idempotent existing:true the concurrent request
    // would have gotten. Non-dedup failures are rethrown untouched (the batch
    // is transactional, so no partial rows survive).
    const raced = await getChannelByDedupKey(db, key);
    if (!raced) {
      throw err;
    }
    return { id: raced.id, existing: true };
  }
  return { id: channelId, existing: false };
}

export async function openGroup(
  db: Db,
  input: { userId: string; userIds: string[] },
): Promise<{ id: string; existing: boolean }> {
  const ids = [...new Set([input.userId, ...input.userIds])];
  const key = await dedupKeyFor("gm", ids);
  const existing = await getChannelByDedupKey(db, key);
  if (existing) {
    return { id: existing.id, existing: true };
  }
  const channelId = id("chn");
  const now = Date.now();
  const inserts = [
    db.insert(channels).values({
      id: channelId,
      teamId: null,
      name: null,
      displayName: "gm",
      type: "gm",
      dedupKey: key,
      creatorId: null,
      createdAt: now,
    }),
    ...ids.map((userId) =>
      db.insert(channelMembers).values({ channelId, userId, roles: "channel_user", joinedAt: now }),
    ),
  ];
  try {
    await db.batch(inserts as [(typeof inserts)[number], ...(typeof inserts)[number][]]);
  } catch (err) {
    // Same dedup-key race handling as openDirect above.
    const raced = await getChannelByDedupKey(db, key);
    if (!raced) {
      throw err;
    }
    return { id: raced.id, existing: true };
  }
  return { id: channelId, existing: false };
}

export async function joinChannel(
  db: Db,
  input: { channelId: string; userId: string },
): Promise<boolean> {
  const ch = await getChannel(db, input.channelId);
  if (!ch) {
    throw apiError("not found", "not found", 404);
  }
  if (ch.type !== "public") {
    throw apiError("forbidden", "forbidden", 403);
  }
  if (ch.teamId && !(await getTeamMember(db, ch.teamId, input.userId))) {
    throw apiError("forbidden", "forbidden", 403);
  }
  if (await getChannelMember(db, input.channelId, input.userId)) {
    return false;
  }
  await addChannelMember(db, {
    channelId: input.channelId,
    userId: input.userId,
    roles: "channel_user",
  });
  return true;
}

export async function leaveChannel(
  db: Db,
  input: { channelId: string; userId: string },
): Promise<void> {
  if (!(await getChannelMember(db, input.channelId, input.userId))) {
    return;
  }
  await removeChannelMember(db, input.channelId, input.userId);
}

export async function archiveChannel(db: Db, input: { channelId: string }): Promise<void> {
  await db.update(channels).set({ archivedAt: Date.now() }).where(eq(channels.id, input.channelId));
}

export async function restoreChannel(db: Db, input: { channelId: string }): Promise<void> {
  await db.update(channels).set({ archivedAt: null }).where(eq(channels.id, input.channelId));
}
