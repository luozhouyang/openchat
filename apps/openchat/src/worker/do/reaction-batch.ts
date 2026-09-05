export interface ReactionBatchDeps {
  getSnapshot: (messageSeq: number) => Promise<Record<string, string[]>>;
  broadcast: (event: {
    type: "reaction.update";
    messageSeq: number;
    reactions: Record<string, string[]>;
  }) => Promise<void>;
}

export function createReactionBatcher(deps: ReactionBatchDeps) {
  const dirty = new Set<number>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function flush() {
    const seqs = [...dirty];
    dirty.clear();
    timer = null;
    for (const seq of seqs) {
      const reactions = await deps.getSnapshot(seq);
      await deps.broadcast({ type: "reaction.update", messageSeq: seq, reactions });
    }
  }

  return {
    markDirty(messageSeq: number) {
      dirty.add(messageSeq);
      if (!timer) {
        timer = setTimeout(() => void flush(), 500);
      }
    },
  };
}
