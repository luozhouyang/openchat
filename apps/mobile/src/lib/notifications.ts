import type { NotificationKind } from "protocol";
import type { TranslationKey } from "./i18n";

const KIND_KEYS: Record<NotificationKind, TranslationKey> = {
  mention: "kindMention",
  reply: "kindReply",
  dm: "kindDm",
};

/** Translation key for an inbox row kind. */
export function notificationKindKey(kind: NotificationKind): TranslationKey {
  return KIND_KEYS[kind] ?? "kindMention";
}
