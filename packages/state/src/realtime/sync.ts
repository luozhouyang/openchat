import type { Message } from "protocol";
import type { MessageDB } from "../db/types.ts";
import { useMessageStore } from "../stores/messages.ts";

/**
 * Channels + lastSeq for the reconnect sync frame. The local DB is the source
 * of truth (it survives reloads and app kills); the live store tops it up with
 * channels hydrated this session but not yet persisted.
 */
export async function buildSyncChannels(
  db: MessageDB,
  maxChannels = 500,
): Promise<{ channelId: string; lastSeq: number }[]> {
  const ids = new Set(await db.listChannels());
  for (const id of Object.keys(useMessageStore.getState().channels)) ids.add(id);
  const out: { channelId: string; lastSeq: number }[] = [];
  for (const channelId of ids) {
    const lastSeq = Math.max(
      useMessageStore.getState().maxSeq(channelId),
      await db.maxSeq(channelId),
    );
    out.push({ channelId, lastSeq });
  }
  return out.slice(0, maxChannels);
}

/**
 * sync.gap means "you are ≥500 messages behind" (system design §4.5): fall
 * back to paged REST history, walking backwards until the pages overlap what
 * we already have locally.
 */
export function createSyncGapHandler(deps: {
  getDb(): Promise<MessageDB>;
  /** Returns one page of history (newest first backwards); page size is the caller's choice. */
  fetchHistory(channelId: string, beforeSeq?: number): Promise<Message[]>;
  maxPages?: number;
}) {
  const maxPages = deps.maxPages ?? 5;
  return async function handleSyncGap(channelId: string): Promise<void> {
    const db = await deps.getDb();
    const localMax = Math.max(
      useMessageStore.getState().maxSeq(channelId),
      await db.maxSeq(channelId),
    );
    let beforeSeq: number | undefined;
    for (let page = 0; page < maxPages; page++) {
      let messages: Message[];
      try {
        messages = await deps.fetchHistory(channelId, beforeSeq);
      } catch {
        return; // offline: the next reconnect sync retries
      }
      if (messages.length === 0) return;
      useMessageStore.getState().applySync(channelId, messages);
      await db.applyGap(
        channelId,
        messages.map((m) => ({ ...m, attachments: m.attachments ?? null })),
      );
      const minSeq = Math.min(...messages.map((m) => m.seq));
      if (minSeq <= localMax + 1) return; // overlapped local history
      beforeSeq = minSeq;
    }
  };
}
