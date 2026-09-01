import { deriveWsUrl, type DesktopBridge, type PlatformAdapter } from "platform";
import { LocalStorageAdapter } from "./web";
import { openLocalDatabase, visibilityAppState } from "./shared";

export interface DesktopFilePlatformOptions {
  /** API origin injected by the Electron main process via the preload bridge. */
  serverUrl: string;
  bridge: DesktopBridge;
}

/**
 * Electron bundled-renderer mode (served over the privileged app:// scheme):
 * no cookies (cross-origin API), so bearer sessions persist through the
 * safeStorage-backed bridge; REST/WS target the injected origin and
 * notifications are the shell's native ones.
 */
export function createDesktopFilePlatform(opts: DesktopFilePlatformOptions): PlatformAdapter {
  return {
    platform: "desktop",
    // Same-origin through the shell's app:// /api proxy — zero CORS. The
    // serverUrl still drives the WebSocket target (WS is not CORS-bound).
    apiBaseUrl: "app://-",
    wsUrl: deriveWsUrl(opts.serverUrl),
    getSessionToken: () => opts.bridge.getToken(),
    setSessionToken: (token) =>
      token === null ? opts.bridge.clearToken() : opts.bridge.setToken(token),
    storage: new LocalStorageAdapter(),
    openLocalDatabase,
    notify: ({ title, body, link }) => {
      opts.bridge.notify(title, body, link);
      return true;
    },
    desktopBridge: opts.bridge,
    onAppStateChange: visibilityAppState,
  } satisfies PlatformAdapter;
}
