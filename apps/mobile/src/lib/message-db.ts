import type { Message } from "protocol";
import type { LocalDatabase, StoreMessage } from "state";
import { createMobilePlatform } from "../platform";

// The platform adapter owns database provisioning (memoized; expo-sqlite is
// always present on device, so there is no degradation chain here).
const platform = createMobilePlatform();

export async function getMessageDB(): Promise<LocalDatabase> {
  return platform.openLocalDatabase();
}

/** Seeds the store from the on-device DB; returns the hydrated row count. */
export async function hydrateChannel(
  channelId: string,
  seed: (rows: Message[]) => void,
): Promise<number> {
  const db = await getMessageDB();
  const { rows } = await db.messages.query(channelId, { limit: 100 });
  if (rows.length > 0) seed(rows);
  return rows.length;
}

export async function persistMessage(channelId: string, message: Message | StoreMessage) {
  const db = await getMessageDB();
  await db.messages.append(channelId, {
    ...message,
    attachments: message.attachments ?? null,
  } as Message);
}

export async function persistMessages(channelId: string, messages: Array<Message | StoreMessage>) {
  if (messages.length === 0) return;
  const db = await getMessageDB();
  await db.messages.applyGap(
    channelId,
    messages.map((m) => ({ ...m, attachments: m.attachments ?? null }) as Message),
  );
}

export async function persistEdit(
  channelId: string,
  messageId: string,
  content: string,
  editedAt: number,
) {
  const db = await getMessageDB();
  await db.messages.edit(channelId, messageId, content, editedAt);
}

export async function persistRemove(channelId: string, messageId: string) {
  const db = await getMessageDB();
  await db.messages.remove(channelId, messageId);
}
