export { MemoryMessageDB } from "./db/memory.ts";
export { SqliteMessageDB } from "./db/sqlite.ts";
// NOTE: runMessageDBContract lives behind the "state/contract" entry (it
// depends on the vitest harness and must stay out of app runtime bundles).
// The node:sqlite NodeSqliteDriver likewise lives behind "state/node".
export type { SqliteDriver } from "./db/driver.ts";
export type { ChannelQuery, MessageDB, MessagePage } from "./db/types.ts";

export { useMessageStore, type StoreMessage } from "./stores/messages.ts";
export { useSidebarStore } from "./stores/sidebar.ts";
export { useTypingStore } from "./stores/typing.ts";
export { usePresenceStore } from "./stores/presence.ts";
export { useConnectionStore } from "./stores/connection.ts";
export { useStructureStore } from "./stores/structure.ts";

export { createDispatcher, type DispatcherDeps } from "./realtime/dispatch.ts";
export { buildSyncChannels, createSyncGapHandler } from "./realtime/sync.ts";
