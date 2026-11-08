import type { UserAutocompleteItem } from "protocol";

/** Display name for a message author; falls back to the raw id when unknown. */
export function personLabel(user: UserAutocompleteItem | undefined, userId: string): string {
  return user?.nickname ?? user?.name ?? user?.username ?? userId;
}

const PRESENCE_COLORS: Record<string, string> = {
  online: "#22c55e",
  away: "#f59e0b",
  dnd: "#ef4444",
  offline: "#a1a1aa",
};

export function presenceColor(status: string | undefined): string {
  return PRESENCE_COLORS[status ?? "offline"] ?? PRESENCE_COLORS.offline;
}
