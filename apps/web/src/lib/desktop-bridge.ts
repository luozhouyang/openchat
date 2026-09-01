/**
 * The Electron shell's preload bridge (apps/desktop/src/preload.ts). Absent in
 * a plain browser — every call site must tolerate null.
 */
export interface DesktopBridge {
  notify(title: string, body: string, link?: string): void;
  getToken(): Promise<string | null>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
  /** API origin injected by the main process ("" when not configured). */
  serverUrl: string;
}

declare global {
  interface Window {
    openchatDesktop?: DesktopBridge;
  }
}

export const desktopBridge: DesktopBridge | null =
  typeof window !== "undefined" ? (window.openchatDesktop ?? null) : null;
