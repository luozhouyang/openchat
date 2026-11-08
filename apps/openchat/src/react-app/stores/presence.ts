import { useEffect } from "react";
import { create } from "zustand";
import { api } from "@/lib/api";

/** Statuses go stale quickly; refetch after this window. */
const STALE_MS = 45_000;
const BATCH_SIZE = 100;

interface PresenceState {
  byId: Record<string, { status: string; at: number }>;
  pending: Record<string, true>;
  ensure(ids: string[]): void;
}

let queue: string[] = [];
let flushScheduled = false;

export const usePresenceStore = create<PresenceState>((set, get) => ({
  byId: {},
  pending: {},
  ensure(ids) {
    const now = Date.now();
    const { byId, pending } = get();
    const missing = [...new Set(ids)].filter((id) => {
      if (!id || pending[id]) {
        return false;
      }
      const entry = byId[id];
      return entry === undefined || now - entry.at > STALE_MS;
    });
    if (missing.length === 0) {
      return;
    }
    set((s) => {
      const next = { ...s.pending };
      for (const id of missing) {
        next[id] = true;
      }
      return { pending: next };
    });
    queue.push(...missing);
    scheduleFlush();
  },
}));

function scheduleFlush(): void {
  if (flushScheduled) {
    return;
  }
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    const ids = [...new Set(queue)];
    queue = [];
    void flush(ids);
  });
}

async function flush(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    try {
      const res = await api.status.getMany({ userIds: chunk });
      const at = Date.now();
      usePresenceStore.setState((s) => {
        const byId = { ...s.byId };
        for (const [userId, status] of Object.entries(res.statuses)) {
          byId[userId] = { status, at };
        }
        return { byId, pending: withoutPending(s.pending, chunk) };
      });
    } catch {
      // Unknown presence renders as offline; clearing pending allows a retry.
      usePresenceStore.setState((s) => ({ pending: withoutPending(s.pending, chunk) }));
    }
  }
}

function withoutPending(pending: Record<string, true>, ids: string[]): Record<string, true> {
  const next = { ...pending };
  for (const id of ids) {
    delete next[id];
  }
  return next;
}

/** Subscribes one component to a user's presence and refreshes it when stale. */
export function useStatus(userId: string | undefined): string {
  const status = usePresenceStore((s) => (userId ? s.byId[userId]?.status : undefined));
  useEffect(() => {
    if (userId) {
      usePresenceStore.getState().ensure([userId]);
    }
  }, [userId]);
  return status ?? "offline";
}
