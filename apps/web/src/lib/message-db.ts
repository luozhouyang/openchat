import type { Message } from "protocol";
import { createMemoryDatabase, createSqliteDatabase, type LocalDatabase } from "state";
import { useMessageStore } from "../stores/messages";

type MessageLike = Omit<Message, "attachments"> & { attachments?: unknown[] | null };

function toMessage(m: MessageLike): Message {
  return { ...m, attachments: m.attachments ?? null };
}

let cached: Promise<LocalDatabase> | null = null;

async function create(): Promise<LocalDatabase> {
  try {
    if (typeof Worker === "undefined") throw new Error("workers unavailable");
    const { SqliteWasmDriver } = await import("./sqlite-wasm-driver");
    const driver = new SqliteWasmDriver();
    await driver.ready();
    const db = createSqliteDatabase(driver);
    await db.migrate();
    return db;
  } catch {
    // No worker/OPFS support (e.g. tests, old browsers): degrade to an
    // in-memory, session-scoped database.
    return createMemoryDatabase();
  }
}

export async function getMessageDB(): Promise<LocalDatabase> {
  cached ??= create();
  return cached;
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
