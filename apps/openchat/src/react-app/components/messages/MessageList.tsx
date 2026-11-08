import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { appClient } from "@/app-client";
import { useMessageStore } from "@/stores/messages";
import { useSidebarStore } from "@/stores/sidebar";
import type { StoreMessage } from "@/stores/messages";
import { MessageRow } from "./MessageRow";

/** Same-author messages inside this window render as one visual block. */
const GROUP_WINDOW_MS = 5 * 60_000;
/** Upper bound for loading history when jumping to a search hit. */
const JUMP_MAX_PAGES = 40;
const HIGHLIGHT_MS = 2_000;

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

type ListItem =
  | { kind: "message"; key: string; message: StoreMessage; compact: boolean }
  | { kind: "divider"; key: string; at: number }
  | { kind: "unread"; key: string };

function sameDay(a: number, b: number): boolean {
  const first = new Date(a);
  const second = new Date(b);
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

export function MessageList({
  channelId,
  loading = false,
}: {
  channelId: string;
  loading?: boolean;
}) {
  // list() derives a fresh array; shallow-compare so unchanged state stays snapshot-stable.
  const list = useMessageStore(useShallow((s) => s.list(channelId)));
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);
  const loadingOlder = useRef(false);
  const autoScroll = useRef(true);
  const prevMaxSeq = useRef(0);
  const [highlightSeq, setHighlightSeq] = useState<number | null>(null);
  const pendingJumpSeq = useRef<number | null>(null);
  // Snapshot the read marker before ChannelView marks the channel read.
  const initialLastRead = useRef<number | null>(null);
  if (initialLastRead.current === null) {
    initialLastRead.current = useSidebarStore.getState().entries[channelId]?.lastReadSeq ?? 0;
  }

  const maxSeq = useMessageStore((s) => s.maxSeq(channelId));

  const items = useMemo(() => {
    const out: ListItem[] = [];
    const lastRead = initialLastRead.current ?? 0;
    let unreadMarked = false;
    list.forEach((message, index) => {
      const prev = list[index - 1];
      if (!prev || !sameDay(prev.createdAt, message.createdAt)) {
        out.push({ kind: "divider", key: `divider-${message.id}`, at: message.createdAt });
      }
      if (!unreadMarked && lastRead > 0 && message.seq > lastRead) {
        out.push({ kind: "unread", key: "unread-divider" });
        unreadMarked = true;
      }
      const compact =
        prev !== undefined &&
        sameDay(prev.createdAt, message.createdAt) &&
        prev.userId === message.userId &&
        !prev.deletedAt &&
        !message.deletedAt &&
        message.createdAt - prev.createdAt < GROUP_WINDOW_MS;
      out.push({ kind: "message", key: message.id, message, compact });
    });
    return out;
  }, [list]);

  const firstMessageSeq = items.find((item) => item.kind === "message")?.message.seq ?? null;

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 10,
    // Message ids stay stable when older pages are prepended, so measurement
    // caches survive the index shift.
    getItemKey: (index) => items[index]!.key,
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
      void jumpTo(detail.seq);
    }
    window.addEventListener("openchat:jump-to-seq", onJump);
    return () => window.removeEventListener("openchat:jump-to-seq", onJump);
    // jumpTo closes over the current store/virtualizer; re-register on change.
  }, [channelId, items, virtualizer]);

  async function jumpTo(seq: number) {
    const findIndex = () =>
      useMessageStore
        .getState()
        .list(channelId)
        .findIndex((message) => message.seq === seq);
    let index = findIndex();
    let pages = 0;
    while (index < 0 && pages < JUMP_MAX_PAGES) {
      const more = await appClient.channels.loadOlder(channelId);
      pages += 1;
      index = findIndex();
      if (!more) {
        break;
      }
    }
    if (index < 0) {
      return;
    }
    // The rendered list interleaves date dividers, so map the message index
    // from the freshly loaded store rather than the pre-load closure.
    const fresh = useMessageStore.getState().list(channelId);
    const messageIndex = fresh.findIndex((message) => message.seq === seq);
    let dividers = 0;
    for (let i = 1; i <= messageIndex; i += 1) {
      const prev = fresh[i - 1];
      const current = fresh[i];
      if (prev && current && !sameDay(prev.createdAt, current.createdAt)) {
        dividers += 1;
      }
    }
    const renderedIndex = messageIndex + dividers;
    setHighlightSeq(seq);
    window.setTimeout(() => setHighlightSeq(null), HIGHLIGHT_MS);
    // Two frames: let the loaded page commit before the virtualizer scrolls.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(renderedIndex, { align: "center" });
      });
    });
  }

  // A notification click stores the target seq before navigating; pick it up
  // once the first history page has rendered.
  useEffect(() => {
    const key = `openchat:jump:${channelId}`;
    const raw = sessionStorage.getItem(key);
    if (!raw) {
      return;
    }
    sessionStorage.removeItem(key);
    const seq = Number(raw);
    if (Number.isFinite(seq)) {
      pendingJumpSeq.current = seq;
    }
  }, [channelId]);

  useEffect(() => {
    if (pendingJumpSeq.current === null || items.length === 0) {
      return;
    }
    const seq = pendingJumpSeq.current;
    pendingJumpSeq.current = null;
    void jumpTo(seq);
    // items.length drives the first render after history arrives.
  }, [items.length]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder.current || firstMessageSeq === null) {
      return;
    }
    loadingOlder.current = true;
    const scrollTop = parentRef.current?.scrollTop ?? 0;
    try {
      // Shared service: fetch page + apply history to store and local DB in
      // one call (no service-layer duplication — the message-db dead layer
      // flagged in the review's P2 dead-code list).
      await appClient.channels.loadOlder(channelId);
      const idx = useMessageStore
        .getState()
        .list(channelId)
        .findIndex((m) => m.seq === firstMessageSeq);
      if (idx >= 0 && parentRef.current) {
        const [offset] = virtualizer.getOffsetForIndex(idx) ?? [0];
        parentRef.current.scrollTop = scrollTop + offset;
      }
    } finally {
      loadingOlder.current = false;
    }
  }, [channelId, firstMessageSeq, virtualizer]);

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
      {items.length === 0 && loading ? (
        <div className="space-y-3 p-4" aria-busy="true">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="h-8 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : items.length === 0 ? (
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
                {item.kind === "unread" ? (
                  <div className="flex items-center gap-3 px-4 py-2 text-xs font-medium text-destructive">
                    <span className="h-px flex-1 bg-destructive/40" />
                    <span>{t("messages.newMessages")}</span>
                    <span className="h-px flex-1 bg-destructive/40" />
                  </div>
                ) : item.kind === "divider" ? (
                  <div className="flex items-center gap-3 px-4 py-2 text-xs text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    <span>{dateFormatter.format(new Date(item.at))}</span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                ) : (
                  <MessageRow
                    message={item.message}
                    channelId={channelId}
                    compact={item.compact}
                    highlight={highlightSeq === item.message.seq}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
