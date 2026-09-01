import { expect, test } from "vite-plus/test";
import { runMessageRepoContract } from "../src/db/contract.ts";
import { createMemoryDatabase } from "../src/db/database.ts";
import { makeMessage } from "./fixtures.ts";

test("memory repository passes the shared contract", async () => {
  const db = createMemoryDatabase();
  await runMessageRepoContract(db.messages);
  await db.close();
});

test("memory database: migrate is a no-op, append is idempotent", async () => {
  const db = createMemoryDatabase();
  await db.migrate();
  await db.messages.append("c1", makeMessage(1));
  await db.messages.append("c1", makeMessage(1));
  expect((await db.messages.query("c1", { limit: 10 })).rows).toHaveLength(1);
});

test("memory database: query empty channel returns empty page", async () => {
  const db = createMemoryDatabase();
  const page = await db.messages.query("c1", { limit: 10 });
  expect(page.rows).toHaveLength(0);
  expect(page.hasMore).toBe(false);
});

test("memory database: edit on missing message is a no-op", async () => {
  const db = createMemoryDatabase();
  await db.messages.edit("c1", "nope", "x", 1);
  await db.messages.remove("c1", "nope");
  expect((await db.messages.query("c1", { limit: 10 })).rows).toHaveLength(0);
});
