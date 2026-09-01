import type { ChannelEvent, Message, ServerEvent } from "protocol";
import type { MessageDB } from "../db/types.ts";
import { useMessageStore } from "../stores/messages.ts";
import { useSidebarStore } from "../stores/sidebar.ts";
import { usePresenceStore } from "../stores/presence.ts";
import { useStructureStore } from "../stores/structure.ts";
import { useTypingStore } from "../stores/typing.ts";

function normalize(m: Message): Message {
  return { ...m, attachments: m.attachments ?? null };
}

export interface DispatcherDeps {
  getDb(): Promise<MessageDB>;
  /** Fired for every confirmed incoming message (notifications, sidebar extras). */
  onMessageNew?(channelId: string, message: Message): void;
  /** sync.gap: the app refetches history — see createSyncGapHandler. */
  onSyncGap?(channelId: string): void;
  /** Verbatim passthrough for events the UI still consumes (hello/error/sync.*). */
  onLocal?(ev: ServerEvent): void;
}

/**
 * Single shared server-event pipeline (p10 spec §5): store updates, local DB
 * persistence, and UI hooks. Web and mobile both feed raw WS text into this;
 * keeping one implementation is what prevents three clients drifting apart.
 */
export function createDispatcher(deps: DispatcherDeps) {
  return function dispatch(raw: string): void {
    if (raw === "ping" || raw === "pong") return; // keepalive frames, not JSON
    let ev: ServerEvent;
    try {
      ev = JSON.parse(raw) as ServerEvent;
    } catch {
      return; // malformed frame: never let transport noise crash the app
    }
    switch (ev.type) {
      case "channel.event": {
        const inner = ev.event as ChannelEvent;
        if (inner.type === "message.new") {
          const message = inner.message as Message;
          useMessageStore.getState().ingest(ev.channelId, message);
          if (message.parentId) useMessageStore.getState().ingestThread(ev.channelId, message);
          // Instant badge; the authoritative sidebar.update follows right after.
          useSidebarStore.getState().bump(ev.channelId);
          void deps.getDb().then((db) => db.append(ev.channelId, normalize(message)));
          deps.onMessageNew?.(ev.channelId, message);
        } else if (inner.type === "thread.reply") {
          const message = (inner as unknown as { message: Message }).message;
          useMessageStore.getState().ingestThread(ev.channelId, message);
          void deps.getDb().then((db) => db.append(ev.channelId, normalize(message)));
          deps.onMessageNew?.(ev.channelId, message);
        } else if (inner.type === "message.edit") {
          useMessageStore
            .getState()
            .edit(ev.channelId, inner.messageId, inner.content, inner.editedAt);
          void deps
            .getDb()
            .then((db) => db.edit(ev.channelId, inner.messageId, inner.content, inner.editedAt));
        } else if (inner.type === "message.delete") {
          useMessageStore.getState().remove(ev.channelId, inner.messageId);
          void deps.getDb().then((db) => db.remove(ev.channelId, inner.messageId));
        } else if (inner.type === "reaction.update") {
          const e = inner as unknown as { messageSeq: number; reactions: Record<string, string[]> };
          useMessageStore.getState().setReactions(ev.channelId, e.messageSeq, e.reactions);
        } else if (inner.type === "typing.start") {
          useTypingStore.getState().mark(ev.channelId, inner.userId, inner.expiresAt);
        }
        break;
      }
      case "sidebar.update":
        useSidebarStore.getState().apply(ev);
        break;
      case "channel.read":
        useSidebarStore.getState().readSync(ev.channelId, ev.lastReadSeq);
        deps.onLocal?.(ev);
        break;
      case "structure.update":
        useStructureStore.getState().bump(ev.scope);
        deps.onLocal?.(ev);
        break;
      case "presence.update":
        usePresenceStore.getState().set(ev.userId, ev.status);
        break;
      case "presence.snapshot":
        usePresenceStore.getState().applySnapshot(ev.states);
        break;
      case "ack":
        useMessageStore
          .getState()
          .ack(ev.channelId, ev.clientToken, { id: ev.messageId, seq: ev.seq });
        break;
      case "error":
        if (ev.clientToken && ev.channelId) {
          useMessageStore.getState().fail(ev.channelId, ev.clientToken);
        }
        deps.onLocal?.(ev);
        break;
      case "sync.result":
        useMessageStore.getState().applySync(ev.channelId, ev.messages);
        void deps.getDb().then((db) => db.applyGap(ev.channelId, ev.messages.map(normalize)));
        deps.onLocal?.(ev);
        break;
      case "sync.gap":
        deps.onSyncGap?.(ev.channelId);
        deps.onLocal?.(ev);
        break;
      case "hello":
        deps.onLocal?.(ev);
        break;
    }
  };
}
