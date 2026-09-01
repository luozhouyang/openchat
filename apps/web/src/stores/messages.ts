// Shared layer (packages/state) owns the canonical stores — the web app only
// re-exports them so components keep their import paths (p10 spec §5).
export { useMessageStore, type StoreMessage } from "state";
