import type { RealtimeClientOptions, RealtimeState, WebSocketLike } from "./types.ts";

const OPEN = 1;

/**
 * Platform-free realtime transport: connect / reconnect / token rotation /
 * heartbeat. All WS events from a superseded socket (closed by the user, or
 * replaced by a newer open) are ignored via a generation counter, and every
 * timer is cancelled on close() so a reconnect never fires afterwards.
 */
export class RealtimeClient {
  private ws: WebSocketLike | null = null;
  private reconnectDelay: number;
  private closedByUser = false;
  private opening = false;
  private generation = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private tokenTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly opts: RealtimeClientOptions;

  constructor(opts: RealtimeClientOptions) {
    this.opts = opts;
    this.reconnectDelay = opts.reconnectBaseMs ?? 1000;
  }

  /** Idempotent: no-ops when a connection is already open or being opened. */
  async connect(deviceId: string) {
    if (this.opening) return;
    if (this.ws && this.ws.readyState === OPEN) return;
    this.closedByUser = false;
    this.opening = true;
    try {
      await this.open(deviceId);
    } finally {
      this.opening = false;
    }
  }

  private async open(deviceId: string) {
    this.clearTimers();
    const gen = ++this.generation;
    this.setState("connecting");
    const token = await this.opts.getToken();
    if (gen !== this.generation) return; // superseded while awaiting the token
    if (!token) {
      this.setState("closed");
      this.opts.onAuthMissing();
      return;
    }
    const url = this.opts.buildUrl(deviceId, token);
    const ws = (this.opts.createSocket ?? ((u) => new WebSocket(u) as unknown as WebSocketLike))(
      url,
    );
    this.ws = ws;
    ws.onopen = () => {
      if (gen !== this.generation) return;
      this.setState("open");
      this.reconnectDelay = this.opts.reconnectBaseMs ?? 1000;
      this.startHeartbeat();
      this.scheduleTokenRefresh();
      this.opts.handlers.onOpen();
    };
    ws.onmessage = (ev) => {
      if (gen !== this.generation) return;
      if (typeof ev.data === "string") this.opts.handlers.onMessage(ev.data);
    };
    ws.onclose = () => {
      if (gen !== this.generation) return;
      this.stopHeartbeat();
      this.tokenTimer = null;
      this.setState(this.closedByUser ? "idle" : "reconnecting");
      if (!this.closedByUser) {
        const delay = this.reconnectDelay + Math.random() * 500;
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.opts.reconnectMaxMs ?? 30_000);
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          if (!this.closedByUser) void this.open(deviceId);
        }, delay);
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
    this.generation++; // invalidate the current socket and any in-flight open()
    this.clearTimers();
    this.ws?.close();
    this.setState("idle");
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

  /**
   * The server auto-answers "ping" with "pong" without waking the DO
   * (setWebSocketAutoResponse). Background browser tabs throttle this timer,
   * which yields the slow-heartbeat behavior for hidden tabs for free.
   */
  private startHeartbeat() {
    this.stopHeartbeat();
    const interval = this.opts.heartbeatIntervalMs ?? 30_000;
    if (interval <= 0) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === OPEN) this.ws.send("ping");
    }, interval);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private clearTimers() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.tokenTimer) clearTimeout(this.tokenTimer);
    this.tokenTimer = null;
    this.stopHeartbeat();
  }

  private setState(s: RealtimeState) {
    this.opts.handlers.onStateChange(s);
  }
}
