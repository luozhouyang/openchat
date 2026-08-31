import { authClient } from "../lib/auth-client";
import { useConnectionStore } from "../stores/connection";
import { useMessageStore } from "../stores/messages";
import { useSidebarStore } from "../stores/sidebar";
import { usePresenceStore } from "../stores/presence";
import { useTypingStore } from "../stores/typing";
import type { ClientFrame, ServerEvent, ChannelEvent, Message } from "protocol";

class WsClient {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private closedByUser = false;
  private tokenTimer: ReturnType<typeof setTimeout> | null = null;

  async connect(deviceId: string) {
    this.closedByUser = false;
    await this.open(deviceId);
  }

  private async open(deviceId: string) {
    useConnectionStore.getState().set("connecting");
    const tokenRes = await authClient.token();
    if (tokenRes.error || !tokenRes.data) {
      window.location.href = "/login";
      return;
    }
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws?deviceId=${deviceId}`);
    this.ws = ws;

    ws.onopen = () => {
      useConnectionStore.getState().set("open");
      this.reconnectDelay = 1000;
      this.scheduleTokenRefresh();
    };
    ws.onmessage = (ev) => this.dispatch(ev.data);
    ws.onclose = () => {
      useConnectionStore.getState().set(this.closedByUser ? "idle" : "reconnecting");
      if (!this.closedByUser) {
        const delay = this.reconnectDelay + Math.random() * 500;
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
        setTimeout(() => void this.open(deviceId), delay);
      }
    };
  }

  private scheduleTokenRefresh() {
    if (this.tokenTimer) clearTimeout(this.tokenTimer);
    this.tokenTimer = setTimeout(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.close(4100, "token-refresh");
      }
    }, 14 * 60_000);
  }

  send(frame: ClientFrame) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  close() {
    this.closedByUser = true;
    this.ws?.close();
  }

  private dispatch(raw: string) {
    const ev = JSON.parse(raw) as ServerEvent;
    switch (ev.type) {
      case "channel.event": {
        const inner = ev.event as ChannelEvent;
        if (inner.type === "message.new") {
          const message = inner.message as Message;
          useMessageStore.getState().ingest(ev.channelId, message);
          useSidebarStore.getState().bump(ev.channelId);
        } else if (inner.type === "message.edit") {
          useMessageStore.getState().edit(ev.channelId, inner.messageId, inner.content);
        } else if (inner.type === "message.delete") {
          useMessageStore.getState().remove(ev.channelId, inner.messageId);
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
      case "error":
      case "sync.result":
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
