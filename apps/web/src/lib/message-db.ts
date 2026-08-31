import type { Message } from "protocol";
import { MemoryMessageDB, SqliteMessageDB, type MessageDB } from "state";
import { SqliteWasmDriver } from "./sqlite-wasm-driver";
import { useMessageStore } from "../stores/messages";

type MessageLike = Omit<Message, "attachments"> & { attachments?: unknown[] | null };

function toMessage(m: MessageLike): Message {
  return { ...m, attachments: m.attachments ?? null };
}

let cached: Promise<MessageDB> | null = null;

async function create(): Promise<MessageDB> {
  try {
    if (typeof Worker === "undefined") throw new Error("workers unavailable");
    const driver = new SqliteWasmDriver();
    await driver.ready();
    const db = new SqliteMessageDB(driver);
    await db.init("*");
    return db;
  } catch {
    // No worker/OPFS support (e.g. tests, old browsers): degrade to in-memory cache.
    return new MemoryMessageDB();
  }
}

export async function getMessageDB(): Promise<MessageDB> {
  cached ??= create();
  return cached;
}

export async function hydrateChannel(channelId: string, db?: MessageDB): Promise<number> {
  const d = db ?? (await getMessageDB());
  const { rows } = await d.query(channelId, { limit: 100 });
  if (rows.length > 0) {
    useMessageStore.getState().applySync(channelId, rows);
  }
  return rows.length;
}

export async function persistMessage(channelId: string, message: MessageLike, db?: MessageDB) {
  const d = db ?? (await getMessageDB());
  await d.append(channelId, toMessage(message));
}

export async function persistMessages(
  channelId: string,
  messages: readonly MessageLike[],
  db?: MessageDB,
) {
  if (messages.length === 0) return;
  const d = db ?? (await getMessageDB());
  await d.applyGap(channelId, messages.map(toMessage));
}

export async function persistEdit(
  channelId: string,
  messageId: string,
  content: string,
  editedAt: number,
  db?: MessageDB,
) {
  const d = db ?? (await getMessageDB());
  await d.edit(channelId, messageId, content, editedAt);
}

export async function persistRemove(channelId: string, messageId: string, db?: MessageDB) {
  const d = db ?? (await getMessageDB());
  await d.remove(channelId, messageId);
}
