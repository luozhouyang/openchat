import type { Message, ServerEvent } from "protocol";
import { serverEventSchema } from "protocol";
import type { LocalDatabase } from "../db/database.ts";
import { useMessageStore } from "../stores/messages.ts";
import { useSidebarStore } from "../stores/sidebar.ts";
import { useTeamsStore } from "../stores/teams.ts";
import { useTypingStore } from "../stores/typing.ts";

function normalize(m: Message): Message {
  return { ...m, attachments: m.attachments ?? null };
}

export interface DispatcherDeps {
  getDb(): Promise<LocalDatabase>;
  /** Current user id for self-targeted events (team.member_removed). */
  selfUserId?: () => string | null;
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
    if (raw === "ping" || raw === "pong") {
      return;
    } // keepalive frames, not JSON
    let ev: ServerEvent;
    try {
      const parsed = serverEventSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        return;
      }
      ev = parsed.data;
    } catch {
      return; // malformed frame: never let transport noise crash the app
    }
    switch (ev.type) {
      case "channel.event": {
        const inner = ev.event;
        if (inner.type === "message.new") {
          const message = inner.message as Message;
          useMessageStore.getState().ingest(ev.channelId, message);
          if (message.parentId) {
            useMessageStore.getState().ingestThread(ev.channelId, message);
          }
          // Instant badge; the authoritative sidebar.update follows right after.
          useSidebarStore.getState().bump(ev.channelId);
          void deps
            .getDb()
            .then((db) => db.messages.append(ev.channelId, normalize(message)))
            .catch(() => {});
          deps.onMessageNew?.(ev.channelId, message);
        } else if (inner.type === "thread.reply") {
          const message = inner.message as Message;
          useMessageStore.getState().ingestThread(ev.channelId, message);
          void deps
            .getDb()
            .then((db) => db.messages.append(ev.channelId, normalize(message)))
            .catch(() => {});
          deps.onMessageNew?.(ev.channelId, message);
        } else if (inner.type === "message.edit") {
          useMessageStore
            .getState()
            .edit(ev.channelId, inner.messageId, inner.content, inner.editedAt);
          void deps
            .getDb()
            .then((db) =>
              db.messages.edit(ev.channelId, inner.messageId, inner.content, inner.editedAt),
            )
            .catch(() => {});
        } else if (inner.type === "message.delete") {
          useMessageStore.getState().remove(ev.channelId, inner.messageId);
          void deps
            .getDb()
            .then((db) => db.messages.remove(ev.channelId, inner.messageId))
            .catch(() => {});
        } else if (inner.type === "reaction.update") {
          useMessageStore.getState().setReactions(ev.channelId, inner.messageSeq, inner.reactions);
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
      case "channel.created":
        useTeamsStore.getState().addChannel(ev.channel);
        break;
      case "channel.updated":
        useTeamsStore.getState().patchChannel(ev.channel);
        break;
      case "channel.deleted":
        useTeamsStore.getState().removeChannel(ev.channelId);
        break;
      case "channel.member_removed":
        // Self-removal drops the channel from this device's view immediately
        // (matches the pre-alignment behavior where router.invalidate refetched
        // and the sidebar lost the channel). Other members' removal is inert —
        // membership lists aren't held in the store.
        if (ev.userId === deps.selfUserId?.()) {
          useTeamsStore.getState().removeChannel(ev.channelId);
        }
        break;
      case "team.updated":
        useTeamsStore.getState().patchTeam(ev.team);
        break;
      case "team.member_added":
        useTeamsStore.getState().addTeam({ ...ev.team, channels: [] });
        break;
      case "team.member_removed":
        if (ev.userId === deps.selfUserId?.()) {
          useTeamsStore.getState().dropTeam(ev.teamId);
        }
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
      case "sync.result": {
        const messages = ev.messages as Message[];
        useMessageStore.getState().applySync(ev.channelId, messages);
        void deps.getDb().then((db) => db.messages.applyGap(ev.channelId, messages.map(normalize)));
        deps.onLocal?.(ev);
        break;
      }
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
