import type { RealtimeClientOptions, RealtimeState, WebSocketLike } from "./types.ts";

const OPEN = 1;

export class RealtimeClient {
  private ws: WebSocketLike | null = null;
  private reconnectDelay: number;
  private closedByUser = false;
  private tokenTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly opts: RealtimeClientOptions;

  constructor(opts: RealtimeClientOptions) {
    this.opts = opts;
    this.reconnectDelay = opts.reconnectBaseMs ?? 1000;
  }

  async connect(deviceId: string) {
    this.closedByUser = false;
    await this.open(deviceId);
  }

  private async open(deviceId: string) {
    this.setState("connecting");
    const token = await this.opts.getToken();
    if (!token) {
      this.opts.onAuthMissing();
      return;
    }
    const url = this.opts.buildUrl(deviceId, token);
    const ws = (this.opts.createSocket ?? ((u) => new WebSocket(u) as unknown as WebSocketLike))(
      url,
    );
    this.ws = ws;
    this.scheduleTokenRefresh();
    ws.onopen = () => {
      this.setState("open");
      this.reconnectDelay = this.opts.reconnectBaseMs ?? 1000;
      this.opts.handlers.onOpen();
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") this.opts.handlers.onMessage(ev.data);
    };
    ws.onclose = () => {
      this.setState(this.closedByUser ? "idle" : "reconnecting");
      if (!this.closedByUser) {
        const delay = this.reconnectDelay + Math.random() * 500;
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.opts.reconnectMaxMs ?? 30_000);
        setTimeout(() => void this.open(deviceId), delay);
      }
    };
    ws.onerror = () => {};
  }

  send(data: string): boolean {
    if (this.ws?.readyState === OPEN) {
      this.ws.send(data);
      return true;
    }
    return false;
  }

  close() {
    this.closedByUser = true;
    this.ws?.close();
  }

  private scheduleTokenRefresh() {
    if (this.tokenTimer) clearTimeout(this.tokenTimer);
    this.tokenTimer = setTimeout(
      () => {
        if (this.ws?.readyState === OPEN) this.ws.close(4100, "token-refresh");
      },
      this.opts.tokenTtlMs ?? 14 * 60_000,
    );
  }

  private setState(s: RealtimeState) {
    this.opts.handlers.onStateChange(s);
  }
}
