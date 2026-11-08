import type { NotificationKind } from "protocol";

const LABELS: Record<NotificationKind, string> = {
  mention: "提及",
  reply: "回复",
  dm: "私信",
};

/** Chinese labels for inbox rows; unknown kinds fall back to the raw value. */
export function notificationLabel(kind: NotificationKind): string {
  return LABELS[kind] ?? kind;
}
