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
  const apiBaseUrl = opts.apiBaseUrl ?? window.location.origin;
  return {
    platform: "web",
    apiBaseUrl,
    wsUrl: deriveWsUrl(apiBaseUrl),
    getSessionToken: async () => null, // cookie mode
    storage: new LocalStorageAdapter(),
    openLocalDatabase,
    onAppStateChange: visibilityAppState,
  } satisfies PlatformAdapter;
}
