import { expect } from "vite-plus/test";
import type { Message } from "protocol";
import type { MessageDB } from "./types.ts";

export async function runMessageDBContract(db: MessageDB) {
  await db.init("c1");
  await db.init("c2");

  // append + query ascending by seq, hasMore boundary
  await db.append("c1", mk(1));
  await db.append("c1", mk(2));
  await db.append("c1", mk(3));
  let { rows, hasMore } = await db.query("c1", { limit: 2 });
  expect(rows.map((m) => m.seq)).toEqual([1, 2]);
  expect(hasMore).toBe(true);
  ({ rows, hasMore } = await db.query("c1", { limit: 3 }));
  expect(rows.map((m) => m.seq)).toEqual([1, 2, 3]);
  expect(hasMore).toBe(false);

  // query beforeSeq backward pagination
  ({ rows } = await db.query("c1", { beforeSeq: 3, limit: 2 }));
  expect(rows.map((m) => m.seq)).toEqual([1, 2]);

  // maxSeq
  expect(await db.maxSeq("c1")).toBe(3);
  expect(await db.maxSeq("missing")).toBe(0);

  // applyGap idempotent upsert (same id overwrites seq, no duplicate rows)
  await db.applyGap("c1", [mk(2, "m2"), mk(4, "m4")]);
  expect(await db.maxSeq("c1")).toBe(4);
  ({ rows } = await db.query("c1", { limit: 10 }));
  expect(rows).toHaveLength(4);
  expect(rows.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);

  // edit / remove
  await db.edit("c1", "m1", "edited", 99);
  ({ rows } = await db.query("c1", { limit: 1 }));
  expect(rows[0].content).toBe("edited");
  expect(rows[0].editedAt).toBe(99);
  await db.remove("c1", "m1");
  ({ rows } = await db.query("c1", { limit: 1 }));
  expect(rows[0].deletedAt).not.toBeNull();

  // cross-channel isolation
  expect(await db.maxSeq("c2")).toBe(0);
  await db.append("c2", mk(1, "x1"));
  expect((await db.query("c2", { limit: 10 })).rows[0].id).toBe("x1");

  // listChannels enumerates every channel that has rows
  expect(new Set(await db.listChannels())).toEqual(new Set(["c1", "c2"]));

  // JSON column round-trip (attachments/mentions)
  await db.append("c1", {
    ...mk(5),
    attachments: [{ type: "image", url: "https://x/y.png" }],
    mentions: ["u2", "u3"],
  });
  const msg5 = (await db.query("c1", { limit: 10 })).rows.find((m) => m.seq === 5)!;
  expect(msg5.attachments).toEqual([{ type: "image", url: "https://x/y.png" }]);
  expect(msg5.mentions).toEqual(["u2", "u3"]);
}

function mk(seq: number, id = `m${seq}`): Message {
  return {
    id,
    seq,
    userId: "u1",
    type: "text",
    content: `msg-${seq}`,
    createdAt: seq,
    parentId: null,
    attachments: null,
    mentions: null,
    editedAt: null,
    deletedAt: null,
  };
}
