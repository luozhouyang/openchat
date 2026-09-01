import { deriveWsUrl, type PlatformAdapter, type StorageAdapter } from "platform";
import { openLocalDatabase, visibilityAppState } from "./shared";

export class LocalStorageAdapter implements StorageAdapter {
  get(key: string): string | null {
    return window.localStorage.getItem(key);
  }
  set(key: string, value: string): void {
    window.localStorage.setItem(key, value);
  }
  remove(key: string): void {
    window.localStorage.removeItem(key);
  }
}

export interface WebPlatformOptions {
  apiBaseUrl?: string;
}

/** Browser / Electron-remote-URL mode: cookie sessions, same-origin REST. */
export function createWebPlatform(opts: WebPlatformOptions = {}): PlatformAdapter {
  // "" is the same-origin marker the shared client core keys its cookie/bearer
  // mode on — REST stays relative; the WS endpoint derives from location.
  const apiBaseUrl = opts.apiBaseUrl ?? "";
  return {
    platform: "web",
    apiBaseUrl,
    wsUrl: deriveWsUrl(opts.apiBaseUrl ?? window.location.origin),
    getSessionToken: async () => null, // cookie mode
    storage: new LocalStorageAdapter(),
    openLocalDatabase,
    notify: () => false, // web notifications go through the PWA service worker
    onAppStateChange: visibilityAppState,
  } satisfies PlatformAdapter;
}
