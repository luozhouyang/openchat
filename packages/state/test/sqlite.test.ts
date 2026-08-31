import { expect, test } from "vite-plus/test";
import type { Message } from "protocol";
import { NodeSqliteDriver } from "../src/db/driver.ts";
import { SqliteMessageDB } from "../src/db/sqlite.ts";
import { runMessageDBContract } from "../src/db/contract.ts";

function make() {
  const driver = new NodeSqliteDriver(":memory:");
  return new SqliteMessageDB(driver);
}

test("sqlite db passes the shared contract (same semantics as memory)", async () => {
  await runMessageDBContract(make());
});

test("schema migrations are idempotent across re-init", async () => {
  const db = make();
  await db.init("c1");
  await db.init("c1");
  await db.append("c1", {
    id: "m1",
    seq: 1,
    userId: "u1",
    type: "text",
    content: "hi",
    createdAt: 1,
    parentId: null,
    attachments: null,
    mentions: null,
    editedAt: null,
    deletedAt: null,
  });
  expect(await db.maxSeq("c1")).toBe(1);
});

test("append same (channel, seq) dedups on conflict", async () => {
  const db = make();
  await db.init("c1");
  const m: Message = {
    id: "m1",
    seq: 1,
    userId: "u1",
    type: "text",
    content: "hi",
    createdAt: 1,
    parentId: null,
    attachments: null,
    mentions: null,
    editedAt: null,
    deletedAt: null,
  };
  await db.append("c1", m);
  await db.append("c1", m);
  expect((await db.query("c1", { limit: 10 })).rows).toHaveLength(1);
});
