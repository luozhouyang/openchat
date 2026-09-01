// Shared layer (packages/state) owns the canonical store — the mobile app
// only re-exports it (p10 spec §5: one store implementation across clients).
export { useMessageStore as useMessages, type StoreMessage } from "state";
