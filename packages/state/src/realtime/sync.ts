import type { Message } from "protocol";
import type { LocalDatabase } from "../db/database.ts";
import { useMessageStore } from "../stores/messages.ts";

/**
 * Channels + lastSeq for the reconnect sync frame. The local DB is the source
 * of truth (it survives reloads and app kills); the live store tops it up with
 * channels hydrated this session but not yet persisted.
 */
export async function buildSyncChannels(
  db: LocalDatabase,
  maxChannels = 500,
): Promise<{ channelId: string; lastSeq: number }[]> {
  const ids = new Set(await db.messages.listChannels());
  for (const id of Object.keys(useMessageStore.getState().channels)) {
    ids.add(id);
  }
  const out: { channelId: string; lastSeq: number }[] = [];
  for (const channelId of ids) {
    const lastSeq = Math.max(
      useMessageStore.getState().maxSeq(channelId),
      await db.messages.maxSeq(channelId),
    );
    out.push({ channelId, lastSeq });
  }
  return out.slice(0, maxChannels);
}

/**
 * The server signals `sync.gap` when its quick catch-up response hit the
 * history cap (user.ts sends gap when the 500-message reply is full). No exact
 * serverLastSeq is carried, so we walk REST history backwards until a page
 * overlaps what we already hold locally — that overlap proves the gap is
 * closed, including anything in between.
 *
 * Review #13: the old version pulled at most maxPages(5) × 30 ≤ 150 messages
 * with no retry, so any ≥500-message hole was left permanent. Now each page
 * requests the server's history cap (500 — see ListPostsQuery / ChannelDO
 * history limit), pages until overlap or until the walk runs off the bottom
 * of server history, and retries the whole walk up to twice with backoff
 * when it terminates early (transient network/server hiccups).
 */
const DEFAULT_GAP_PAGE_SIZE = 500; // REST/DO history limit (ListPostsQuery.max(500))
const DEFAULT_MAX_PAGES = 10; // 10 × 500 covers any plausible catch-up deficit
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Store refill (review round 2 P1-1): the gap walk itself only writes into the
 * local DB (`applyGap`) — the store's `applySync` ignores anything ≤ maxSeq, so
 * the middle of the open channel's list would stay hollow until a full
 * rehydrate. Closing the walk therefore rebuilds the store channel from the DB
 * through the same write path `channels.hydrate` uses (query → applySync), with
 * one difference: reset first so historical mid-holes are refilled too.
 * Pending (optimistic, seq 0) messages are snapshotted and re-appended —
 * the refill must never eject an in-flight send. mark_read semantics are
 * untouched: the refilled maxSeq is a superset of the pre-walk head (every
 * live message is also appended to the DB), so read cursors never move back.
 */
async function refillStore(channelId: string, db: LocalDatabase): Promise<void> {
  const store = useMessageStore.getState();
  const pending = store.channels[channelId] ? [...store.channels[channelId].pending.entries()] : [];
  store.reset(channelId);
  // Full local list (not hydrate's 100-row page): the refill must restore
  // every row, including anything loadOlder pulled during this session.
  const { rows } = await db.messages.query(channelId, { limit: 5000 });
  if (rows.length > 0) {
    store.applySync(channelId, rows);
  }
  for (const [token, message] of pending) {
    store.appendPending(channelId, token, message);
  }
}

export function createSyncGapHandler(deps: {
  getDb(): Promise<LocalDatabase>;
  /** Returns one page of history (newest first backwards). */
  fetchHistory(channelId: string, beforeSeq?: number, limit?: number): Promise<Message[]>;
  /** Page size requested per hop. Default 500 (server history cap). */
  gapPageSize?: number;
  /** Safety cap on pages per walk attempt. Default 10. */
  maxPages?: number;
  /** Retries of the whole walk after an early termination. Default 2. */
  retries?: number;
  /** Backoff between retries (linear). Default 2000ms. */
  backoffMs?: number;
}) {
  const gapPageSize = deps.gapPageSize ?? DEFAULT_GAP_PAGE_SIZE;
  const maxPages = deps.maxPages ?? DEFAULT_MAX_PAGES;
  const retries = deps.retries ?? DEFAULT_RETRIES;
  const backoffMs = deps.backoffMs ?? DEFAULT_BACKOFF_MS;

  /** One full backwards walk. Throws when it ends with the gap still open. */
  async function walk(channelId: string, db: LocalDatabase): Promise<void> {
    const localMax = Math.max(
      useMessageStore.getState().maxSeq(channelId),
      await db.messages.maxSeq(channelId),
    );
    let beforeSeq: number | undefined = undefined;
    for (let page = 0; page < maxPages; page++) {
      // Transport failures propagate so the outer retry loop can re-walk.
      const messages = await deps.fetchHistory(channelId, beforeSeq, gapPageSize);
      if (messages.length === 0) {
        // No history below `beforeSeq` (or the channel is empty): impossible
        // to page further. Not transient — do not retry.
        if (beforeSeq !== undefined) {
          console.warn(
            `[openchat] sync.gap: history exhausted below seq ${beforeSeq} for ${channelId}; gap not fully closed`,
          );
        }
        return;
      }
      useMessageStore.getState().applySync(channelId, messages);
      await db.messages.applyGap(
        channelId,
        messages.map((m) => ({ ...m, attachments: m.attachments ?? null })),
      );
      const minSeq = Math.min(...messages.map((m) => m.seq));
      if (minSeq <= localMax + 1) {
        return; // overlapped local history: the gap is closed
      }
      if (messages.length < gapPageSize) {
        // A short page is the bottom of server history (DO returns at most
        // `limit` rows); nothing below exists to fill further gaps.
        console.warn(
          `[openchat] sync.gap: server history ends at seq ${minSeq} for ${channelId}; old blocks below local head stay missing`,
        );
        return;
      }
      beforeSeq = minSeq;
    }
    throw new Error(
      `[openchat] sync.gap: history for ${channelId} still not overlapped after ${maxPages} pages`,
    );
  }

  return async function handleSyncGap(channelId: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await walk(channelId, await deps.getDb());
        break; // normal end, including the abandoned/short-history paths
      } catch (error) {
        if (attempt >= retries) {
          console.warn(`[openchat] sync.gap: backfill failed for ${channelId}`, error);
          break; // the next reconnect's sync frame retries from scratch
        }
        await sleep(backoffMs * (attempt + 1));
      }
    }
    // Refill the store either way: whatever reached the DB is shown now.
    await refillStore(channelId, await deps.getDb());
  };
}
