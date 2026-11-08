import { RealtimeClient, type WebSocketLike } from "realtime";
import type { ClientFrame, Message, ServerEvent } from "protocol";
import type { LocalDatabase } from "../db/database.ts";
import { useConnectionStore } from "../stores/connection.ts";
import { createDispatcher, type DispatcherDeps } from "./dispatch.ts";
import { buildSyncChannels, createSyncGapHandler } from "./sync.ts";

export interface RealtimeConnectionDeps {
  wsUrl: string;
  /** WS upgrade token (short-lived JWT — see the auth service). */
  getToken(): Promise<string | null>;
  getDb(): Promise<LocalDatabase>;
  /** One page of history; `limit` overrides the caller's default page size (gap backfill uses it). */
  fetchHistory(channelId: string, beforeSeq?: number, limit?: number): Promise<Message[]>;
  onAuthMissing?(): void;
  /** Current user id for self-targeted events (team.member_removed). */
  selfUserId?: () => string | null;
  /** UI hooks: notifications, self-message filtering, sidebar extras. */
  onMessageNew?(channelId: string, message: Message): void;
  /**
   * Verbatim passthrough for events the UI still consumes; apps surface
   * `error` frames themselves (see ws/client.ts).
   */
  onLocal?(ev: ServerEvent): void;
  /** Test seam for a fake socket. */
  createSocket?(url: string): WebSocketLike;
}

export interface RealtimeConnection {
  connect(deviceId: string): Promise<void>;
  close(): void;
  send(frame: ClientFrame): boolean;
  /** User-interaction liveness signal (presence + push suppression). */
  sendActivity(): boolean;
  /** Exposed for tests: feed a raw frame through the shared pipeline. */
  dispatch(raw: string): void;
}

/**
 * The realtime bootstrap every client shares (P12-C): transport construction,
 * reconnect sync from the local DB, gap refills, the shared dispatcher and
 * connection state — apps only inject their UI hooks.
 */
export function createRealtimeConnection(deps: RealtimeConnectionDeps): RealtimeConnection {
  const handleSyncGap = createSyncGapHandler({
    getDb: deps.getDb,
    fetchHistory: deps.fetchHistory,
  });
  // Per-channel in-flight guard (review round 2 P1-1b): sync.gap retries fire
  // on every new sync frame while a walk may already be paging (up to 10 × 500
  // messages); overlapping walks would redo the same work on the same channel.
  // Deduplicate until the current walk finishes (its inner retry/backoff loop
  // is part of one invocation), and let a frame that arrives during the final
  // refill schedule the next run.
  const activeWalks = new Set<string>();
  const dispatch = createDispatcher({
    getDb: deps.getDb,
    selfUserId: deps.selfUserId,
    onMessageNew: deps.onMessageNew,
    onLocal: deps.onLocal,
    onSyncGap: (channelId) => {
      if (activeWalks.has(channelId)) {
        return;
      }
      activeWalks.add(channelId);
      void handleSyncGap(channelId)
        .catch(() => {}) // the handler is self-contained; never crash the pipeline
        .finally(() => activeWalks.delete(channelId));
    },
  } satisfies Partial<DispatcherDeps> & Pick<DispatcherDeps, "getDb">);

  const client = new RealtimeClient({
    getToken: deps.getToken,
    buildUrl: (deviceId, token) => `${deps.wsUrl}?deviceId=${deviceId}&token=${token}`,
    onAuthMissing: () => deps.onAuthMissing?.(),
    createSocket: deps.createSocket,
    handlers: {
      onOpen: () => void sendSync(),
      onMessage: (raw) => dispatch(raw),
      onStateChange: (state) => useConnectionStore.getState().set(state),
    },
  });

  async function sendSync() {
    const db = await deps.getDb();
    const channels = await buildSyncChannels(db);
    if (channels.length > 0) {
      client.send(JSON.stringify({ type: "sync", channels }));
    }
  }

  return {
    connect: (deviceId) => client.connect(deviceId),
    close: () => client.close(),
    send: (frame) => client.send(JSON.stringify(frame)),
    sendActivity: () => client.send(JSON.stringify({ type: "activity" })),
    dispatch,
  };
}
