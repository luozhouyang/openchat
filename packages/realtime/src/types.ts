export type RealtimeState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export interface RealtimeHandlers {
  onOpen(): void;
  onMessage(raw: string): void;
  onStateChange(state: RealtimeState): void;
}

export interface RealtimeClientOptions {
  getToken(): Promise<string | null>;
  buildUrl(deviceId: string, token: string): string;
  onAuthMissing(): void;
  createSocket?: (url: string) => WebSocketLike;
  handlers: RealtimeHandlers;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  tokenTtlMs?: number;
  /** Interval between "ping" keepalives while open. 0 disables. */
  heartbeatIntervalMs?: number;
}
