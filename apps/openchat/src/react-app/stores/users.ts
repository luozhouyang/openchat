import { useEffect } from "react";
import { create } from "zustand";
import type { UserAutocompleteItem } from "protocol";
import { api } from "@/lib/api";

export type UserProfile = UserAutocompleteItem;

interface UsersState {
  byId: Record<string, UserProfile>;
  /** In-flight lookups; also the retry guard for failed batches. */
  pending: Record<string, true>;
  ensure(ids: string[]): void;
}

/** REST batch cap (ListUsersQuery accepts at most 100 ids per call). */
const BATCH_SIZE = 100;

let queue: string[] = [];
let flushScheduled = false;

export const useUsersStore = create<UsersState>((set, get) => ({
  byId: {},
  pending: {},
  ensure(ids) {
    const { byId, pending } = get();
    const missing = [...new Set(ids)].filter((id) => id && !byId[id] && !pending[id]);
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

/**
 * Coalesces the per-row `ensure` calls of one render pass into one request.
 * A microtask is enough: rows mount in the same commit.
 */
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
      const res = await api.users.list(chunk);
      const fetched: Record<string, UserProfile> = {};
      for (const user of res.users) {
        fetched[user.id] = user;
      }
      useUsersStore.setState((s) => ({
        byId: { ...s.byId, ...fetched },
        pending: withoutPending(s.pending, chunk),
      }));
    } catch {
      // Unknown authors fall back to the raw id; clearing pending lets a
      // later render retry the batch instead of caching the failure forever.
      useUsersStore.setState((s) => ({ pending: withoutPending(s.pending, chunk) }));
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

/** Subscribes one component to a profile and requests it when missing. */
export function useUser(userId: string): UserProfile | undefined {
  const user = useUsersStore((s) => s.byId[userId]);
  useEffect(() => {
    useUsersStore.getState().ensure([userId]);
  }, [userId]);
  return user;
}

/** nickname → name → username → raw id, matching the sidebar's precedence. */
export function displayNameOf(user: UserProfile | undefined, fallback: string): string {
  return user?.nickname?.trim() || user?.name?.trim() || user?.username?.trim() || fallback;
}

/** Two-letter avatar fallback; CJK names keep a single glyph. */
export function initialsOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "?";
  }
  if (/[\u3400-\u9fff]/.test(trimmed)) {
    return [...trimmed][0] ?? "?";
  }
  const words = trimmed.split(/\s+/);
  if (words.length > 1) {
    return `${words[0]![0] ?? ""}${words[1]![0] ?? ""}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}
