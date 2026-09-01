import type { Message } from "protocol";
import type { LocalDatabase } from "../db/database.ts";
import { useMessageStore } from "../stores/messages.ts";

/**
 * History sources vary in shape: the REST list output omits the attachments
 * column while WS events carry it. Services accept the wider type and
 * normalize on persist.
 */
export type MessageLike = Omit<Message, "attachments"> & { attachments?: unknown[] | null };

export function normalizeMessage(m: MessageLike): Message {
  return { ...m, attachments: m.attachments ?? null } as Message;
}

export interface ChannelsServiceDeps {
  getDb(): Promise<LocalDatabase>;
  fetchHistory(channelId: string, beforeSeq?: number): Promise<MessageLike[]>;
  pageSize?: number;
}

export interface ChannelsService {
  /** Seeds the store from the local database (instant, offline-capable). */
  hydrate(channelId: string): Promise<number>;
  /** Applies a page of history to store + local DB (REST results, refills). */
  applyHistory(channelId: string, messages: MessageLike[]): Promise<void>;
  /** Pages older history backwards; returns whether more pages may exist. */
  loadOlder(channelId: string): Promise<boolean>;
}

export function createChannelsService(deps: ChannelsServiceDeps): ChannelsService {
  const pageSize = deps.pageSize ?? 30;

  async function applyHistory(channelId: string, messages: MessageLike[]): Promise<void> {
    if (messages.length === 0) return;
    useMessageStore.getState().applySync(channelId, messages);
    const db = await deps.getDb();
    await db.messages.applyGap(channelId, messages.map(normalizeMessage));
  }

  return {
    async hydrate(channelId) {
      const db = await deps.getDb();
      const { rows } = await db.messages.query(channelId, { limit: 100 });
      if (rows.length > 0) useMessageStore.getState().applySync(channelId, rows);
      return rows.length;
    },

    applyHistory,

    async loadOlder(channelId) {
      const oldest = useMessageStore
        .getState()
        .list(channelId)
        .find((m) => m.seq > 0)?.seq;
      if (oldest === undefined || oldest <= 1) return false;
      const page = await deps.fetchHistory(channelId, oldest);
      await applyHistory(channelId, page);
      return page.length >= pageSize;
    },
  };
}
