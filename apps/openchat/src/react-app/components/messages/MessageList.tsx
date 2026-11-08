import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { appClient } from "@/app-client";
import { useMessageStore } from "@/stores/messages";
import { MessageRow } from "./MessageRow";

/** Same-author messages inside this window render as one visual block. */
const GROUP_WINDOW_MS = 5 * 60_000;

export function MessageList({ channelId }: { channelId: string }) {
  // list() derives a fresh array; shallow-compare so unchanged state stays snapshot-stable.
  const list = useMessageStore(useShallow((s) => s.list(channelId)));
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);
  const loadingOlder = useRef(false);
  const autoScroll = useRef(true);
  const prevMaxSeq = useRef(0);

  const maxSeq = useMessageStore((s) => s.maxSeq(channelId));

  const items = useMemo(
    () =>
      list.map((message, index) => {
        const prev = list[index - 1];
        const compact =
          prev !== undefined &&
          prev.userId === message.userId &&
          !prev.deletedAt &&
          !message.deletedAt &&
          message.createdAt - prev.createdAt < GROUP_WINDOW_MS;
        return { message, compact };
      }),
    [list],
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 10,
    // Message ids stay stable when older pages are prepended, so measurement
    // caches survive the index shift.
    getItemKey: (index) => items[index]!.message.id,
  });

  useEffect(() => {
    if (maxSeq > prevMaxSeq.current && autoScroll.current && items.length > 0) {
      virtualizer.scrollToIndex(items.length - 1, { align: "end" });
    }
    prevMaxSeq.current = maxSeq;
  }, [maxSeq, items.length, virtualizer]);

  useEffect(() => {
    function onJump(event: Event) {
      const detail = (event as CustomEvent<{ channelId: string; seq: number }>).detail;
      if (!detail || detail.channelId !== channelId) {
        return;
      }
      const index = items.findIndex((item) => item.message.seq === detail.seq);
      if (index >= 0) {
        virtualizer.scrollToIndex(index, { align: "center" });
      }
    }
    window.addEventListener("openchat:jump-to-seq", onJump);
    return () => window.removeEventListener("openchat:jump-to-seq", onJump);
  }, [channelId, items, virtualizer]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder.current || items.length === 0) {
      return;
    }
    loadingOlder.current = true;
    const anchorSeq = items[0]!.message.seq;
    const scrollTop = parentRef.current?.scrollTop ?? 0;
    try {
      // Shared service: fetch page + apply history to store and local DB in
      // one call (no service-layer duplication — the message-db dead layer
      // flagged in the review's P2 dead-code list).
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
  }, [channelId, items, virtualizer]);

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
      {items.length === 0 ? (
        <div className="grid h-full place-items-center text-sm text-muted-foreground">
          {t("messages.emptyChannel")}
        </div>
      ) : (
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const item = items[vi.index]!;
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <MessageRow message={item.message} channelId={channelId} compact={item.compact} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
