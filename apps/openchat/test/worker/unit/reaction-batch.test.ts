import { expect, test } from "vite-plus/test";
import { createReactionBatcher } from "@worker/do/reaction-batch";

test("markDirty persists and flush broadcasts each seq once", async () => {
  const persisted: number[][] = [];
  const broadcasts: number[] = [];
  const batcher = createReactionBatcher({
    getSnapshot: async (seq) => ({ "👍": [`usr_${seq}`] }),
    broadcast: async (event) => {
      broadcasts.push(event.messageSeq);
    },
    loadDirty: async () => persisted.at(-1) ?? [],
    saveDirty: async (seqs) => {
      persisted.push([...seqs]);
    },
    schedule: async () => {},
  });

  await batcher.markDirty(3);
  await batcher.markDirty(7);
  expect(persisted.at(-1)).toEqual([3, 7]);

  await batcher.flush();
  expect(broadcasts).toEqual([3, 7]);
  expect(persisted.at(-1)).toEqual([]);

  await batcher.flush();
  expect(broadcasts).toEqual([3, 7]);
});

test("a fresh batcher resumes seqs persisted before eviction", async () => {
  const persisted: number[][] = [[11]];
  const broadcasts: number[] = [];
  const batcher = createReactionBatcher({
    getSnapshot: async (seq) => ({ "🔥": [`usr_${seq}`] }),
    broadcast: async (event) => {
      broadcasts.push(event.messageSeq);
    },
    loadDirty: async () => persisted.at(-1) ?? [],
    saveDirty: async (seqs) => {
      persisted.push([...seqs]);
    },
    schedule: async () => {},
  });

  await batcher.flush();
  expect(broadcasts).toEqual([11]);
  expect(persisted.at(-1)).toEqual([]);
});
