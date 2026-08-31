import { RealtimeClient } from "realtime";
import { platform } from "../lib/platform";
import { persistEdit, persistMessage, persistRemove } from "../lib/message-db";
import { useConnectionStore } from "../stores/connection";
import { useMessageStore } from "../stores/messages";
import { useSidebarStore } from "../stores/sidebar";
import { usePresenceStore } from "../stores/presence";
import { useTypingStore } from "../stores/typing";
import type { ClientFrame, ServerEvent, ChannelEvent, Message } from "protocol";

class WsClient {
  private realtime: RealtimeClient;

  constructor() {
    this.realtime = new RealtimeClient({
      getToken: () => platform.getAuthToken(),
      buildUrl: (deviceId) => `${platform.serverUrl}?deviceId=${deviceId}`,
      onAuthMissing: () => {
        window.location.href = "/login";
      },
      handlers: {
        onOpen: () => this.sendSync(),
        onMessage: (raw) => this.dispatch(raw),
        onStateChange: (state) => useConnectionStore.getState().set(state),
      },
    });
  }

  async connect(deviceId: string) {
    await this.realtime.connect(deviceId);
  }

  send(frame: ClientFrame) {
    this.realtime.send(JSON.stringify(frame));
  }

  close() {
    this.realtime.close();
  }

  private sendSync() {
    const channels = Object.keys(useMessageStore.getState().channels);
    if (channels.length > 0) {
      this.send({
        type: "sync",
        channels: channels.map((channelId) => ({
          channelId,
          lastSeq: useMessageStore.getState().maxSeq(channelId),
        })),
      });
    }
  }

  private dispatch(raw: string) {
    const ev = JSON.parse(raw) as ServerEvent;
    switch (ev.type) {
      case "channel.event": {
        const inner = ev.event as ChannelEvent;
        if (inner.type === "message.new") {
          const message = inner.message as Message;
          useMessageStore.getState().ingest(ev.channelId, message);
          if (message.parentId) useMessageStore.getState().ingestThread(ev.channelId, message);
          useSidebarStore.getState().bump(ev.channelId);
          void persistMessage(ev.channelId, message);
        } else if (inner.type === "message.edit") {
          useMessageStore.getState().edit(ev.channelId, inner.messageId, inner.content);
          void persistEdit(ev.channelId, inner.messageId, inner.content, inner.editedAt);
        } else if (inner.type === "message.delete") {
          useMessageStore.getState().remove(ev.channelId, inner.messageId);
          void persistRemove(ev.channelId, inner.messageId);
        } else if (inner.type === "reaction.update") {
          const e = inner as { messageSeq: number; reactions: Record<string, string[]> };
          useMessageStore.getState().setReactions(ev.channelId, e.messageSeq, e.reactions);
        } else if (inner.type === "thread.reply") {
          const e = inner as { message: Message };
          useMessageStore.getState().ingestThread(ev.channelId, e.message);
          void persistMessage(ev.channelId, e.message);
        } else if (inner.type === "typing.start") {
          useTypingStore.getState().mark(ev.channelId, inner.userId, inner.expiresAt);
        }
        break;
      }
      case "sidebar.update":
        useSidebarStore.getState().apply(ev);
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
      case "error": {
        const channelId = (ev as { channelId?: string }).channelId;
        if (ev.clientToken && channelId) {
          useMessageStore.getState().fail(channelId, ev.clientToken);
        }
        this.emitLocal(ev);
        break;
      }
      case "sync.result":
        this.emitLocal(ev);
        break;
      case "sync.gap":
      case "channel.read":
      case "hello":
        this.emitLocal(ev);
        break;
    }
  }

  private localHandlers = new Set<(ev: ServerEvent) => void>();
  onLocal(cb: (ev: ServerEvent) => void) {
    this.localHandlers.add(cb);
    return () => this.localHandlers.delete(cb);
  }
  private emitLocal(ev: ServerEvent) {
    for (const cb of this.localHandlers) cb(ev);
  }
}

export const wsClient = new WsClient();
