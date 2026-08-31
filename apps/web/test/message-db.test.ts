import { expect, test } from "vite-plus/test";
import { MemoryMessageDB } from "state";
import { getMessageDB, hydrateChannel, persistMessage } from "../src/lib/message-db";
import { useMessageStore } from "../src/stores/messages";

const msg = {
  id: "m1",
  seq: 1,
  userId: "u1",
  type: "text" as const,
  content: "hi",
  createdAt: 1,
  parentId: null,
  attachments: null,
  mentions: null,
  editedAt: null,
  deletedAt: null,
};

test("persistMessage appends to injected db", async () => {
  const db = new MemoryMessageDB();
  await db.init("c1");
  await persistMessage("c1", msg, db);
  expect(await db.maxSeq("c1")).toBe(1);
});

test("hydrateChannel seeds store from db and returns count", async () => {
  const db = new MemoryMessageDB();
  await db.init("c1");
  await db.append("c1", msg);
  useMessageStore.getState().reset("c1");
  const n = await hydrateChannel("c1", db);
  expect(n).toBe(1);
  expect(useMessageStore.getState().list("c1")).toHaveLength(1);
  expect(useMessageStore.getState().maxSeq("c1")).toBe(1);
});

test("getMessageDB degrades to a working db without worker/OPFS (jsdom)", async () => {
  const db = await getMessageDB();
  await db.init("c1");
  await db.append("c1", msg);
  expect(await db.maxSeq("c1")).toBe(1);
  const { rows } = await db.query("c1", { limit: 10 });
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe("m1");
});
