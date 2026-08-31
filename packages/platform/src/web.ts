import { LocalStorageAdapter } from "./storage.ts";
import type { AppLifecycle, PlatformAdapter } from "./types.ts";

export interface WebPlatformOptions {
  getAuthToken(): Promise<string | null>;
  serverUrl?: string;
}

export function createWebPlatform(opts: WebPlatformOptions): PlatformAdapter {
  const serverUrl =
    opts.serverUrl ??
    `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
  return {
    platform: "web",
    serverUrl,
    getAuthToken: () => opts.getAuthToken(),
    storage: new LocalStorageAdapter(),
    onAppStateChange(cb: (s: AppLifecycle) => void) {
      const handler = () => cb(document.visibilityState === "hidden" ? "background" : "active");
      document.addEventListener("visibilitychange", handler);
      return () => document.removeEventListener("visibilitychange", handler);
    },
  };
}
