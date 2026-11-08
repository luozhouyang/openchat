export interface ReactionBatchDeps {
  getSnapshot: (messageSeq: number) => Promise<Record<string, string[]>>;
  broadcast: (event: {
    type: "reaction.update";
    messageSeq: number;
    reactions: Record<string, string[]>;
  }) => Promise<void>;
  /** Dirty seqs persisted before the flush, so DO eviction cannot drop them. */
  loadDirty: () => Promise<number[]>;
  saveDirty: (seqs: number[]) => Promise<void>;
  /** Arms the DO alarm for the near-future flush. */
  schedule: () => Promise<void>;
}

/**
 * Coalesces reaction broadcasts: writes mark the seq dirty and persist it, the
 * alarm flushes one `reaction.update` per seq. Unlike a bare setTimeout the
 * pending work survives DO eviction because the dirty set lives in storage.
 */
export function createReactionBatcher(deps: ReactionBatchDeps) {
  const dirty = new Set<number>();
  let loaded = false;
  let chain: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = chain.then(task, task);
    chain = next;
    return next;
  }

  async function ensureLoaded(): Promise<void> {
    if (loaded) {
      return;
    }
    loaded = true;
    for (const seq of await deps.loadDirty()) {
      dirty.add(seq);
    }
  }

  return {
    markDirty(messageSeq: number): Promise<void> {
      return enqueue(async () => {
        await ensureLoaded();
        dirty.add(messageSeq);
        await deps.saveDirty([...dirty]);
        await deps.schedule();
      });
    },
    /** Flushes pending seqs; returns whether anything was broadcast. */
    flush(): Promise<boolean> {
      return enqueue(async () => {
        await ensureLoaded();
        if (dirty.size === 0) {
          return false;
        }
        const seqs = [...dirty];
        dirty.clear();
        await deps.saveDirty([]);
        for (const seq of seqs) {
          const reactions = await deps.getSnapshot(seq);
          await deps.broadcast({ type: "reaction.update", messageSeq: seq, reactions });
        }
        return true;
      });
    },
  };
}
