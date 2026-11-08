import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { appClient } from "@/app-client";
import { useMessageStore } from "@/stores/messages";
import { MessageRow } from "./MessageRow";

export function MessageList({ channelId }: { channelId: string }) {
  // list() derives a fresh array; shallow-compare so unchanged state stays snapshot-stable.
  const list = useMessageStore(useShallow((s) => s.list(channelId)));
  const parentRef = useRef<HTMLDivElement>(null);
  const loadingOlder = useRef(false);
  const autoScroll = useRef(true);
  const prevMaxSeq = useRef(0);

  const maxSeq = useMessageStore((s) => s.maxSeq(channelId));

  const virtualizer = useVirtualizer({
    count: list.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 10,
  });

  useEffect(() => {
    if (maxSeq > prevMaxSeq.current && autoScroll.current && list.length > 0) {
      virtualizer.scrollToIndex(list.length - 1, { align: "end" });
    }
    prevMaxSeq.current = maxSeq;
  }, [maxSeq, list.length, virtualizer]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder.current || list.length === 0) {
      return;
    }
    loadingOlder.current = true;
    const anchorSeq = list[0].seq;
    const scrollTop = parentRef.current?.scrollTop ?? 0;
    try {
      // Shared service: fetch page + apply history to store and local DB in
      // one call (no service-layer duplication, review P2 死代码段).
      await appClient.channels.loadOlder(channelId);
      const idx = useMessageStore
        .getState()
        .list(channelId)
        .findIndex((m) => m.seq === anchorSeq);
      if (idx >= 0 && parentRef.current) {
        const [offset] = virtualizer.getOffsetForIndex(idx) ?? [0];
        parentRef.current.scrollTop = scrollTop + offset;
      }
    } finally {
      loadingOlder.current = false;
    }
  }, [channelId, list, virtualizer]);

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto"
      onScroll={(e) => {
        if (e.currentTarget.scrollTop < 100) {
          void loadOlder();
        }
        autoScroll.current =
          e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight <
          80;
      }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((vi) => (
          <div
            key={vi.key}
            style={{ position: "absolute", top: vi.start, width: "100%", height: vi.size }}
          >
            <MessageRow message={list[vi.index]} channelId={channelId} />
          </div>
        ))}
      </div>
    </div>
  );
}
