export { createMemoryDatabase, createSqliteDatabase, type LocalDatabase } from "./db/database.ts";
export { runMigrations, wipeDatabase, type Migration } from "./db/migrations.ts";
export { MIGRATIONS, SCHEMA_V1 } from "./db/schema.ts";
// NOTE: runMessageRepoContract lives behind the "state/contract" entry (it
// depends on the vitest harness and must stay out of app runtime bundles).
// The node:sqlite NodeSqliteDriver likewise lives behind "state/node".
export type { SqliteDriver } from "./db/driver.ts";
export type { ChannelQuery, MessagePage, MessageRepository } from "./db/types.ts";
export { MemoryMessageRepository } from "./db/memory.ts";
export { SqliteMessageRepository } from "./db/sqlite.ts";
export { SqliteTxRunner } from "./db/tx.ts";

export { useMessageStore, type StoreMessage } from "./stores/messages.ts";
export { useSidebarStore } from "./stores/sidebar.ts";
export { useTypingStore } from "./stores/typing.ts";
export { usePresenceStore } from "./stores/presence.ts";
export { useConnectionStore } from "./stores/connection.ts";
export { useStructureStore } from "./stores/structure.ts";

export { createDispatcher, type DispatcherDeps } from "./realtime/dispatch.ts";
export { buildSyncChannels, createSyncGapHandler } from "./realtime/sync.ts";
export {
  createRealtimeConnection,
  type RealtimeConnection,
  type RealtimeConnectionDeps,
} from "./realtime/connection.ts";

export { createAuthService, type AuthService, type AuthServiceDeps } from "./services/auth.ts";
export {
  createChannelsService,
  type ChannelsService,
  type ChannelsServiceDeps,
} from "./services/channels.ts";
export {
  createMessagesService,
  type MessagesService,
  type MessagesServiceDeps,
} from "./services/messages.ts";
export {
  createAppClient,
  type AppClient,
  type AppClientPlatform,
  type CreateAppClientOptions,
} from "./app.ts";
