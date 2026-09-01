import type { Message } from "protocol";
import { createSqliteDatabase, type LocalDatabase, type StoreMessage } from "state";
import { ExpoSqliteDriver } from "../db/expo-driver";

let cached: Promise<LocalDatabase> | null = null;

export async function getMessageDB(): Promise<LocalDatabase> {
  cached ??= create();
  return cached;
}

async function create(): Promise<LocalDatabase> {
  const db = createSqliteDatabase(new ExpoSqliteDriver());
  await db.migrate();
  return db;
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
