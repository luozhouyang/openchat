import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef } from "react";
import { useMessageStore } from "../../stores/messages";
import { apiFetch } from "../../lib/api";
import { MessageRow } from "./MessageRow";
import type { Message } from "protocol";

export function MessageList({ channelId }: { channelId: string }) {
  const list = useMessageStore((s) => s.list(channelId));
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
    if (loadingOlder.current || list.length === 0) return;
    loadingOlder.current = true;
    const anchorSeq = list[0].seq;
    const scrollTop = parentRef.current?.scrollTop ?? 0;
    try {
      const res = await apiFetch<{ messages: Message[] }>(
        `/api/channels/${channelId}/history?before_seq=${anchorSeq}&limit=30`,
      );
      useMessageStore.getState().applySync(channelId, res.messages);
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
        if (e.currentTarget.scrollTop < 100) void loadOlder();
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
            <MessageRow message={list[vi.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
