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
 * sessions persist through the safeStorage-backed bridge, REST/WS target
 * the injected origin, notifications are the shell's native ones and the
 * router runs on hash history.
 */
export function createDesktopFilePlatform(opts: DesktopFilePlatformOptions): PlatformAdapter {
  return {
    platform: "desktop",
    apiBaseUrl: opts.serverUrl,
    wsUrl: deriveWsUrl(opts.serverUrl),
    getSessionToken: () => opts.bridge.getToken(),
    setSessionToken: (token) =>
      token === null ? opts.bridge.clearToken() : opts.bridge.setToken(token),
    storage: new LocalStorageAdapter(),
    openLocalDatabase,
    usesHashRouting: true,
    notify: ({ title, body, link }) => {
      opts.bridge.notify(title, body, link);
      return true;
    },
    desktopBridge: opts.bridge,
    onAppStateChange: visibilityAppState,
  } satisfies PlatformAdapter;
}
