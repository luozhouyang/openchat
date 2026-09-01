import type { LocalDatabase } from "state";

export type PlatformId = "web" | "ios" | "android" | "desktop";
export type AppLifecycle = "active" | "background";

export interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface PushAdapter {
  register(): Promise<void>;
}

/**
 * The Electron shell's preload bridge. Absent in browsers — every consumer
 * must tolerate it (and desktopBridge on the adapter being undefined).
 */
export interface DesktopBridge {
  notify(title: string, body: string, link?: string): void;
  getToken(): Promise<string | null>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
  /** API origin injected by the main process ("" when not configured). */
  serverUrl: string;
}

/**
 * Everything a client app must provide from its host environment. This
 * package is the CONTRACT only — implementations live in each app
 * (apps/web/src/platform, apps/mobile/src/platform.ts) and are type-checked
 * against this interface at their own compile boundary. Selection policy
 * (e.g. the web no-Worker fallback chain) is an implementation detail of the
 * platform that owns it.
 */
export interface PlatformAdapter {
  platform: PlatformId;
  /** REST origin; "" means same-origin relative requests (cookie mode). */
  apiBaseUrl: string;
  /** Full WebSocket URL. */
  wsUrl: string;
  /** REST bearer session token; null in cookie mode. */
  getSessionToken(): Promise<string | null>;
  /**
   * Persists the bearer session token (SecureStore / desktop bridge);
   * absent in cookie mode (the better-auth cookie owns the session).
   */
  setSessionToken?(token: string | null): Promise<void>;
  storage: StorageAdapter;
  /** Opens (and memoizes) the local database; degradation chain lives here. */
  openLocalDatabase(): Promise<LocalDatabase>;
  /** True when the router must run on hash history (file:// shells). */
  usesHashRouting: boolean;
  /**
   * Best-effort background notification (desktop native notifications,
   * no-op where the platform has no channel). Returns false when dropped.
   */
  notify(payload: { title: string; body: string; link?: string }): boolean;
  push?: PushAdapter;
  desktopBridge?: DesktopBridge;
  onAppStateChange(cb: (s: AppLifecycle) => void): () => void;
}

/** Pure helper: derives the WS endpoint from a REST origin. */
export function deriveWsUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/^http/, "ws")}/ws`;
}
