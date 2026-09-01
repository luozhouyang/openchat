import type { Message } from "protocol";
import { SqliteMessageDB, type MessageDB } from "state";
import { ExpoSqliteDriver } from "../db/expo-driver";

let cached: Promise<MessageDB> | null = null;

export async function getMessageDB(): Promise<MessageDB> {
  cached ??= create();
  return cached;
}

async function create(): Promise<MessageDB> {
  const db = new SqliteMessageDB(new ExpoSqliteDriver());
  await db.init("*");
  return db;
}

/** Seeds the store from the on-device DB; returns the hydrated row count. */
export async function hydrateChannel(
  channelId: string,
  seed: (rows: Message[]) => void,
): Promise<number> {
  const db = await getMessageDB();
  const { rows } = await db.query(channelId, { limit: 100 });
  if (rows.length > 0) seed(rows);
  return rows.length;
}

export async function persistMessage(channelId: string, message: Message) {
  const db = await getMessageDB();
  await db.append(channelId, { ...message, attachments: message.attachments ?? null });
}

export async function persistMessages(channelId: string, messages: Message[]) {
  if (messages.length === 0) return;
  const db = await getMessageDB();
  await db.applyGap(
    channelId,
    messages.map((m) => ({ ...m, attachments: m.attachments ?? null })),
  );
}

export async function persistEdit(
  channelId: string,
  messageId: string,
  content: string,
  editedAt: number,
) {
  const db = await getMessageDB();
  await db.edit(channelId, messageId, content, editedAt);
}

export async function persistRemove(channelId: string, messageId: string) {
  const db = await getMessageDB();
  await db.remove(channelId, messageId);
}
