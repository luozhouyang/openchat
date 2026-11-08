import type { ClientFrame, ServerEvent } from "protocol";
import { appClient } from "@/app-client";
import { queryClient } from "@/lib/query-client";
import { platform } from "@/lib/platform";

/**
 * Thin web wrapper over the shared realtime connection (P12-D): everything
 * generic (transport, sync, gap refill, dispatch, connection state) lives in
 * packages/state — this file only adds the web's UI hooks.
 */
class WsClient {
  private deviceId: string | null = null;
  private selfUserId: string | null = null;
  /** Subscribers for server `error` frames (reaction rate limits, …). */
  private errorListeners = new Set<(ev: Extract<ServerEvent, { type: "error" }>) => void>();
  private connection = appClient.createRealtime({
    onMessageNew: (channelId, message) => {
      this.notifyBackground(channelId, message);
      // Mentions land in the in-app inbox; refresh the bell without waiting
      // for its polling interval.
      if (this.selfUserId && message.mentions?.includes(this.selfUserId)) {
        void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      }
    },
    onAuthMissing: () => {
      window.location.href = "/auth/login";
    },
    selfUserId: () => this.selfUserId,
    onLocal: (ev) => {
      if (ev.type === "notifications.read") {
        void queryClient.invalidateQueries({ queryKey: ["notifications"] });
        return;
      }
      if (ev.type !== "error") {
        return;
      }
      // Minimal surfacing — no new UI system (review round 2 P1-3).
      console.warn(`[openchat] server rejected a client frame (${ev.code}): ${ev.message}`, ev);
      for (const listener of this.errorListeners) {
        listener(ev);
      }
    },
  });

  /**
   * Optional hook: components may observe server error frames (e.g. an
   * attributed react failure via {@link ClientFrame.clientToken}). Always
   * returns an unregister function.
   */
  onError(listener: (ev: Extract<ServerEvent, { type: "error" }>) => void): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
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

  private notifyBackground(
    channelId: string,
    message: { userId: string; content: string; mentions?: string[] | null },
  ) {
    if (!document.hidden) {
      return;
    }
    if (this.selfUserId && message.userId === this.selfUserId) {
      return;
    }
    platform.notify({
      title: "openchat",
      body: message.content.slice(0, 100),
      link: `openchat://c/${channelId}`,
    });
  }
}

export const wsClient = new WsClient();
