import { RealtimeClient } from "realtime";
import { createDispatcher, createSyncGapHandler, buildSyncChannels } from "state";
import type { ClientFrame } from "protocol";
import { api } from "../lib/api";
import { platform } from "../lib/platform";
import { desktopBridge } from "../lib/desktop-bridge";
import { getMessageDB } from "../lib/message-db";
import { useConnectionStore } from "../stores/connection";

class WsClient {
  private realtime: RealtimeClient;
  private deviceId: string | null = null;
  private selfUserId: string | null = null;
  private handleSyncGap = createSyncGapHandler({
    getDb: getMessageDB,
    fetchHistory: async (channelId, beforeSeq) => {
      const res = await api.posts.list(channelId, { limit: 100, beforeSeq });
      // The REST list output omits attachments; normalize to the protocol shape.
      return res.messages.map((m) => ({
        ...m,
        attachments: (m as { attachments?: unknown[] | null }).attachments ?? null,
      }));
    },
  });
  private dispatch = createDispatcher({
    getDb: getMessageDB,
    onMessageNew: (channelId, message) => this.notifyDesktop(channelId, message),
    onSyncGap: (channelId) => void this.handleSyncGap(channelId),
  });

  constructor() {
    this.realtime = new RealtimeClient({
      getToken: () => platform.getAuthToken(),
      buildUrl: (deviceId, token) => `${platform.serverUrl}?deviceId=${deviceId}&token=${token}`,
      onAuthMissing: () => {
        // file:// (hash router) must not navigate to a filesystem path.
        if (window.location.protocol === "file:") window.location.hash = "#/login";
        else window.location.href = "/login";
      },
      handlers: {
        onOpen: () => void this.sendSync(),
        onMessage: (raw) => this.dispatch(raw),
        onStateChange: (state) => useConnectionStore.getState().set(state),
      },
    });
  }

  /**
   * App-level connection entry (root layout): idempotent, one socket per
   * browser tab regardless of team/channel navigation.
   */
  async ensureConnected() {
    this.deviceId ??= localStorage.getItem("deviceId") ?? crypto.randomUUID();
    localStorage.setItem("deviceId", this.deviceId);
    if (this.selfUserId === null) {
      try {
        const me = await api.me();
        this.selfUserId = me.user.id;
      } catch {
        this.selfUserId = null; // notifications just lose self-filtering
      }
    }
    await this.realtime.connect(this.deviceId);
  }

  send(frame: ClientFrame) {
    this.realtime.send(JSON.stringify(frame));
  }

  /** User-interaction liveness signal (presence + push suppression, §5.5). */
  sendActivity() {
    this.send({ type: "activity" });
  }

  close() {
    this.realtime.close();
  }

  private async sendSync() {
    const db = await getMessageDB();
    const channels = await buildSyncChannels(db);
    if (channels.length > 0) {
      this.send({ type: "sync", channels });
    }
  }

  private notifyDesktop(channelId: string, message: { userId: string; content: string }) {
    if (!desktopBridge) return;
    if (!document.hidden) return;
    if (this.selfUserId && message.userId === this.selfUserId) return;
    desktopBridge.notify("openchat", message.content.slice(0, 100), `openchat://c/${channelId}`);
  }
}

export const wsClient = new WsClient();
