import { expect, test } from "vite-plus/test";
import type { Message } from "protocol";
import { NodeSqliteDriver } from "../src/db/driver.ts";
import { runMessageRepoContract } from "../src/db/contract.ts";
import { createSqliteDatabase } from "../src/db/database.ts";

function make() {
  return createSqliteDatabase(new NodeSqliteDriver(":memory:"));
}

test("sqlite repository passes the shared contract (same semantics as memory)", async () => {
  const db = make();
  await db.migrate();
  await runMessageRepoContract(db.messages);
  await db.close();
});

test("migrate is idempotent and repositories work across repeated calls", async () => {
  const db = make();
  await db.migrate();
  await db.migrate();
  await db.messages.append("c1", msg(1));
  expect(await db.messages.maxSeq("c1")).toBe(1);
  await db.close();
});

test("append same (channel, seq) dedups on conflict", async () => {
  const db = make();
  await db.migrate();
  const m = msg(1);
  await db.messages.append("c1", m);
  await db.messages.append("c1", m);
  expect((await db.messages.query("c1", { limit: 10 })).rows).toHaveLength(1);
  await db.close();
});

test("transaction commits atomically and rolls back on failure", async () => {
  const db = make();
  await db.migrate();
  await db.transaction(async () => {
    await db.messages.append("c1", msg(1));
    await db.messages.append("c1", msg(2));
  });
  expect(await db.messages.maxSeq("c1")).toBe(2);

  await expect(
    db.transaction(async () => {
      await db.messages.append("c1", msg(3));
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  expect(await db.messages.maxSeq("c1")).toBe(2); // seq 3 rolled back
  await db.close();
});

test("repository transactions join an outer container transaction", async () => {
  const db = make();
  await db.migrate();
  await db.transaction(async () => {
    // applyGap opens its own transaction internally; inside the container's
    // transaction it must join, not nest (which would throw in SQLite).
    await db.messages.applyGap("c1", [msg(1), msg(2), msg(3)]);
  });
  expect(await db.messages.maxSeq("c1")).toBe(3);
  await db.close();
});

function msg(seq: number): Message {
  return {
    id: `m${seq}`,
    seq,
    userId: "u1",
    type: "text",
    content: `hi-${seq}`,
    createdAt: seq,
    parentId: null,
    attachments: null,
    mentions: null,
    editedAt: null,
    deletedAt: null,
  };
}
