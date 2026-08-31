import { expect, test } from "vite-plus/test";
import { MemoryMessageDB } from "../src/db/memory.ts";
import { runMessageDBContract } from "../src/db/contract.ts";
import { makeMessage } from "./fixtures.ts";

test("memory db passes the shared contract", async () => {
  await runMessageDBContract(new MemoryMessageDB());
});

test("append same (channel, seq) is idempotent", async () => {
  const db = new MemoryMessageDB();
  await db.init("c1");
  await db.append("c1", makeMessage(1));
  await db.append("c1", makeMessage(1));
  expect((await db.query("c1", { limit: 10 })).rows).toHaveLength(1);
});

test("query empty channel returns empty page", async () => {
  const db = new MemoryMessageDB();
  await db.init("c1");
  const page = await db.query("c1", { limit: 10 });
  expect(page.rows).toHaveLength(0);
  expect(page.hasMore).toBe(false);
});

test("edit on missing message is a no-op", async () => {
  const db = new MemoryMessageDB();
  await db.init("c1");
  await db.edit("c1", "nope", "x", 1);
  await db.remove("c1", "nope");
  expect((await db.query("c1", { limit: 10 })).rows).toHaveLength(0);
});
