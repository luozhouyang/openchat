// @vitest-environment jsdom
// Imports lib/platform (→ auth-client) which reads window.location at init.
import { expect, test } from "vite-plus/test";
import { createMemoryDatabase } from "state";
import { getMessageDB, hydrateChannel, persistMessage } from "@/lib/message-db";
import { useMessageStore } from "@/stores/messages";

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
  const db = createMemoryDatabase();
  await db.migrate();
  await persistMessage("c1", msg, db);
  expect(await db.messages.maxSeq("c1")).toBe(1);
});

test("hydrateChannel seeds store from db and returns count", async () => {
  const db = createMemoryDatabase();
  await db.migrate();
  await db.messages.append("c1", msg);
  useMessageStore.getState().reset("c1");
  const n = await hydrateChannel("c1", db);
  expect(n).toBe(1);
  expect(useMessageStore.getState().list("c1")).toHaveLength(1);
  expect(useMessageStore.getState().maxSeq("c1")).toBe(1);
});

test("getMessageDB degrades to a working db without worker/OPFS (jsdom)", async () => {
  const db = await getMessageDB();
  await db.migrate();
  await db.messages.append("c1", msg);
  expect(await db.messages.maxSeq("c1")).toBe(1);
  const { rows } = await db.messages.query("c1", { limit: 10 });
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe("m1");
});
