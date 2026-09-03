import type { Message } from "protocol";
import type { LocalDatabase } from "state";
import { useMessageStore } from "../stores/messages";
import { platform } from "./platform";

type MessageLike = Omit<Message, "attachments"> & { attachments?: unknown[] | null };

function toMessage(m: MessageLike): Message {
  return { ...m, attachments: m.attachments ?? null };
}

/** Delegates to the platform adapter (owns the fallback chain, memoized). */
export async function getMessageDB(): Promise<LocalDatabase> {
  return platform.openLocalDatabase();
}

export async function hydrateChannel(channelId: string, db?: LocalDatabase): Promise<number> {
  const d = db ?? (await getMessageDB());
  const { rows } = await d.messages.query(channelId, { limit: 100 });
  if (rows.length > 0) {
    useMessageStore.getState().applySync(channelId, rows);
  }
  return rows.length;
}

export async function persistMessage(channelId: string, message: MessageLike, db?: LocalDatabase) {
  const d = db ?? (await getMessageDB());
  await d.messages.append(channelId, toMessage(message));
}

export async function persistMessages(
  channelId: string,
  messages: readonly MessageLike[],
  db?: LocalDatabase,
) {
  if (messages.length === 0) return;
  const d = db ?? (await getMessageDB());
  await d.messages.applyGap(channelId, messages.map(toMessage));
}

export async function persistEdit(
  channelId: string,
  messageId: string,
  content: string,
  editedAt: number,
  db?: LocalDatabase,
) {
  const d = db ?? (await getMessageDB());
  await d.messages.edit(channelId, messageId, content, editedAt);
}

export async function persistRemove(channelId: string, messageId: string, db?: LocalDatabase) {
  const d = db ?? (await getMessageDB());
  await d.messages.remove(channelId, messageId);
}
