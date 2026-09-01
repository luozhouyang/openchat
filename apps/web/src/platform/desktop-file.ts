import { deriveWsUrl, type DesktopBridge, type PlatformAdapter } from "platform";
import { LocalStorageAdapter } from "./web";
import { openLocalDatabase, visibilityAppState } from "./shared";

export interface DesktopFilePlatformOptions {
  /** API origin injected by the Electron main process via the preload bridge. */
  serverUrl: string;
  bridge: DesktopBridge;
}

/**
 * Electron file:// mode: no cookies, no usable window.location — bearer
 * sessions live in the safeStorage-backed bridge, REST/WS target the
 * injected origin, hash routing is assumed by the app.
 */
export function createDesktopFilePlatform(opts: DesktopFilePlatformOptions): PlatformAdapter {
  return {
    platform: "desktop",
    apiBaseUrl: opts.serverUrl,
    wsUrl: deriveWsUrl(opts.serverUrl),
    getSessionToken: () => opts.bridge.getToken(),
    storage: new LocalStorageAdapter(),
    openLocalDatabase,
    desktopBridge: opts.bridge,
    onAppStateChange: visibilityAppState,
  } satisfies PlatformAdapter;
}
