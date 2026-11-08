import { asc, eq, gt } from "drizzle-orm";
import { channelDoName } from "protocol";
import { getDb } from "@worker/db/client";
import { channelMembers, channels, systemSettings } from "@worker/db/schema-d1";
import { getChannel } from "@worker/db/repos/channels";
import { apiError } from "@worker/lib/errors";

export interface ReconcileResult {
  channelId: string;
  added: number;
  removed: number;
}

export interface ReconcileBatchResult {
  checked: number;
  added: number;
  removed: number;
}

const CURSOR_KEY = "reconcile_cursor";

function roleOf(roles: string): "admin" | "member" {
  return roles
    .split(",")
    .map((role) => role.trim())
    .includes("channel_admin")
    ? "admin"
    : "member";
}

/**
 * Makes the Channel DO member_state match the D1 membership rows (D1 is the
 * source of truth for structure). Returns how many members were added/removed.
 */
export async function reconcileChannel(env: Env, channelId: string): Promise<ReconcileResult> {
  const db = getDb(env.DB);
  const channel = await getChannel(db, channelId);
  if (!channel) {
    throw apiError("not found", "channel not found", 404);
  }
  const rows = await db
    .select({ userId: channelMembers.userId, roles: channelMembers.roles })
    .from(channelMembers)
    .where(eq(channelMembers.channelId, channelId));
  const d1 = new Map(rows.map((row) => [row.userId, roleOf(row.roles)]));
  const stub = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
  const doIds = new Set(await stub.memberIds());
  const missing = [...d1.keys()].filter((userId) => !doIds.has(userId));
  const extra = [...doIds].filter((userId) => !d1.has(userId));
  for (const userId of missing) {
    await stub.membersAdd({ userId, role: d1.get(userId)! });
  }
  for (const userId of extra) {
    await stub.removeMember(userId);
  }
  return { channelId, added: missing.length, removed: extra.length };
}

/**
 * Reconciles a rotating slice of channels so the hourly cron eventually covers
 * every channel without doing a full scan in one invocation.
 */
export async function reconcileBatch(env: Env, limit = 5): Promise<ReconcileBatchResult> {
  const db = getDb(env.DB);
  const cursorRow = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, CURSOR_KEY))
    .limit(1);
  const cursor = cursorRow[0]?.value ?? "";
  const rows = await db
    .select({ id: channels.id })
    .from(channels)
    .where(cursor ? gt(channels.id, cursor) : undefined)
    .orderBy(asc(channels.id))
    .limit(limit);

  const result: ReconcileBatchResult = { checked: 0, added: 0, removed: 0 };
  for (const row of rows) {
    try {
      const channelResult = await reconcileChannel(env, row.id);
      result.checked += 1;
      result.added += channelResult.added;
      result.removed += channelResult.removed;
    } catch (err) {
      console.error(`reconcile failed for ${row.id}`, err);
    }
  }
  const last = rows.at(-1)?.id;
  if (last) {
    await db
      .insert(systemSettings)
      .values({ key: CURSOR_KEY, value: last, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: last, updatedAt: Date.now() },
      });
  } else if (cursor) {
    await db
      .update(systemSettings)
      .set({ value: "", updatedAt: Date.now() })
      .where(eq(systemSettings.key, CURSOR_KEY));
  }
  return result;
}
