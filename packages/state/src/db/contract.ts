import { expect } from "vite-plus/test";
import type { Message } from "protocol";
import type { MessageRepository } from "./types.ts";

/**
 * Shared assertions for MessageRepository implementations (sqlite + memory):
 * one suite pins that the menu items are interchangeable, which is what lets
 * each platform pick its factory without semantic drift.
 */
export async function runMessageRepoContract(repo: MessageRepository) {
  // append + query ascending by seq, hasMore boundary
  await repo.append("c1", mk(1));
  await repo.append("c1", mk(2));
  await repo.append("c1", mk(3));
  let { rows, hasMore } = await repo.query("c1", { limit: 2 });
  expect(rows.map((m) => m.seq)).toEqual([1, 2]);
  expect(hasMore).toBe(true);
  ({ rows, hasMore } = await repo.query("c1", { limit: 3 }));
  expect(rows.map((m) => m.seq)).toEqual([1, 2, 3]);
  expect(hasMore).toBe(false);

  // query beforeSeq backward pagination
  ({ rows } = await repo.query("c1", { beforeSeq: 3, limit: 2 }));
  expect(rows.map((m) => m.seq)).toEqual([1, 2]);

  // maxSeq
  expect(await repo.maxSeq("c1")).toBe(3);
  expect(await repo.maxSeq("missing")).toBe(0);

  // applyGap idempotent upsert (same id overwrites seq, no duplicate rows)
  await repo.applyGap("c1", [mk(2, "m2"), mk(4, "m4")]);
  expect(await repo.maxSeq("c1")).toBe(4);
  ({ rows } = await repo.query("c1", { limit: 10 }));
  expect(rows).toHaveLength(4);
  expect(rows.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);

  // edit / remove
  await repo.edit("c1", "m1", "edited", 99);
  ({ rows } = await repo.query("c1", { limit: 1 }));
  expect(rows[0].content).toBe("edited");
  expect(rows[0].editedAt).toBe(99);
  await repo.remove("c1", "m1");
  ({ rows } = await repo.query("c1", { limit: 1 }));
  expect(rows[0].deletedAt).not.toBeNull();

  // cross-channel isolation
  expect(await repo.maxSeq("c2")).toBe(0);
  await repo.append("c2", mk(1, "x1"));
  expect((await repo.query("c2", { limit: 10 })).rows[0].id).toBe("x1");

  // listChannels enumerates every channel that has rows
  expect(new Set(await repo.listChannels())).toEqual(new Set(["c1", "c2"]));

  // JSON column round-trip (attachments/mentions)
  await repo.append("c1", {
    ...mk(5),
    attachments: [{ type: "image", url: "https://x/y.png" }],
    mentions: ["u2", "u3"],
  });
  const msg5 = (await repo.query("c1", { limit: 10 })).rows.find((m) => m.seq === 5)!;
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
