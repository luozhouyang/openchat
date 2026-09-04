import type { ClientFrame } from "protocol";
import { appClient } from "@/app-client";
import { platform } from "@/lib/platform";

/**
 * Thin web wrapper over the shared realtime connection (P12-D): everything
 * generic (transport, sync, gap refill, dispatch, connection state) lives in
 * packages/state — this file only adds the web's UI hooks.
 */
class WsClient {
  private deviceId: string | null = null;
  private selfUserId: string | null = null;
  private connection = appClient.createRealtime({
    onMessageNew: (channelId, message) => this.notifyBackground(channelId, message),
    onAuthMissing: () => {
      window.location.href = "/auth/login";
    },
  });

  /**
   * App-level connection entry (root layout): idempotent, one socket per
   * browser tab regardless of team/channel navigation.
   */
  async ensureConnected() {
    this.deviceId ??= localStorage.getItem("deviceId") ?? crypto.randomUUID();
    localStorage.setItem("deviceId", this.deviceId);
    if (this.selfUserId === null) {
      try {
        const me = await appClient.api.me();
        this.selfUserId = me.user.id;
      } catch {
        this.selfUserId = null; // notifications just lose self-filtering
      }
    }
    await this.connection.connect(this.deviceId);
  }

  send(frame: ClientFrame) {
    this.connection.send(frame);
  }

  /** User-interaction liveness signal (presence + push suppression, §5.5). */
  sendActivity() {
    this.connection.sendActivity();
  }

  close() {
    this.connection.close();
  }

  private notifyBackground(channelId: string, message: { userId: string; content: string }) {
    if (!document.hidden) return;
    if (this.selfUserId && message.userId === this.selfUserId) return;
    platform.notify({
      title: "openchat",
      body: message.content.slice(0, 100),
      link: `openchat://c/${channelId}`,
    });
  }
}

export const wsClient = new WsClient();
