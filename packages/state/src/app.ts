import { createApi } from "protocol";
import type { LocalDatabase } from "./db/database.ts";
import { createAuthService, type AuthService } from "./services/auth.ts";
import { createChannelsService, type ChannelsService } from "./services/channels.ts";
import { createMessagesService, type MessagesService } from "./services/messages.ts";
import {
  createRealtimeConnection,
  type RealtimeConnection,
  type RealtimeConnectionDeps,
} from "./realtime/connection.ts";

/**
 * The port the shared client core needs (D10): platform adapters satisfy it
 * structurally, so state never imports the platform package and the runtime
 * dependency stays one-way (platform → state).
 */
export interface AppClientPlatform {
  /** "" means cookie mode (same-origin REST, credentials included). */
  apiBaseUrl: string;
  wsUrl: string;
  getSessionToken(): Promise<string | null>;
  setSessionToken?(token: string | null): Promise<void>;
  openLocalDatabase(): Promise<LocalDatabase>;
  push?: { register(): Promise<void> };
}

export interface CreateAppClientOptions {
  platform: AppClientPlatform;
  /** REST history page size (loadOlder heuristics). Default 30. */
  historyPageSize?: number;
}

export interface AppClient {
  /** Unified REST client (composition root construction, reviewed decision). */
  api: ReturnType<typeof createApi>;
  auth: AuthService;
  channels: ChannelsService;
  messages: MessagesService;
  getWsJwt(): Promise<string | null>;
  openLocalDatabase(): Promise<LocalDatabase>;
  registerPush(): Promise<void>;
  /** Apps create their connection here, injecting UI hooks only. */
  createRealtime(
    hooks?: Pick<
      RealtimeConnectionDeps,
      "onMessageNew" | "onAuthMissing" | "createSocket" | "selfUserId" | "onLocal"
    >,
  ): RealtimeConnection;
}

export function createAppClient(opts: CreateAppClientOptions): AppClient {
  const { platform } = opts;
  const cookieMode = platform.apiBaseUrl === "";
  const pageSize = opts.historyPageSize ?? 30;

  // REST is constructed once here (decision #3): cookie mode keeps relative
  // paths + credentials; bearer mode targets the injected origin.
  const api = createApi({
    baseUrl: platform.apiBaseUrl,
    getToken: cookieMode ? undefined : () => platform.getSessionToken(),
    credentials: cookieMode ? "include" : "omit",
  });

  const getDb = () => platform.openLocalDatabase();
  const auth = createAuthService({
    apiBaseUrl: platform.apiBaseUrl,
    getSessionToken: () => platform.getSessionToken(),
    setSessionToken: platform.setSessionToken,
  });

  const fetchHistory = async (channelId: string, beforeSeq?: number, limit?: number) => {
    const res = await api.posts.list(channelId, { limit: limit ?? pageSize, beforeSeq });
    // The REST list output omits attachments; normalize to the protocol shape.
    return res.messages.map((m) => ({
      ...m,
      attachments: (m as { attachments?: unknown[] | null }).attachments ?? null,
    }));
  };

  const channels = createChannelsService({ getDb, fetchHistory, pageSize });
  const messages = createMessagesService({
    getDb,
    createPost: (channelId, input) => api.posts.create(channelId, input),
  });

  return {
    api,
    auth,
    channels,
    messages,
    getWsJwt: () => auth.getWsJwt(),
    openLocalDatabase: () => platform.openLocalDatabase(),
    registerPush: () => platform.push?.register() ?? Promise.resolve(),
    createRealtime: (hooks) =>
      createRealtimeConnection({
        wsUrl: platform.wsUrl,
        getToken: () => auth.getWsJwt(),
        getDb,
        fetchHistory,
        ...hooks,
      }),
  };
}
