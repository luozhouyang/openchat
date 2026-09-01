import * as SecureStore from "expo-secure-store";
import { AppState, Platform } from "react-native";
import type { AppLifecycle, PlatformAdapter, StorageAdapter } from "platform";
import { API_URL, wsUrl } from "./lib/config";
import { getWsJwt } from "./lib/auth";

const secureStorage: StorageAdapter = {
  get: (key) => {
    // SecureStore is async-only; platform consumers use getAuthToken()/async
    // flows, so the sync StorageAdapter surface is backed by a warm cache.
    return cache.get(key) ?? null;
  },
  set: (key, value) => {
    cache.set(key, value);
    void SecureStore.setItemAsync(key, value);
  },
  remove: (key) => {
    cache.delete(key);
    void SecureStore.deleteItemAsync(key);
  },
};
const cache = new Map<string, string>();

export function createMobilePlatform(): PlatformAdapter {
  return {
    platform: Platform.OS === "ios" ? "ios" : "android",
    serverUrl: wsUrl(API_URL, "/ws"),
    // The WS upgrade requires a short-lived JWT (not the stored session
    // token): getWsJwt fetches one from /api/auth/token with caching.
    getAuthToken: () => getWsJwt(),
    storage: secureStorage,
    onAppStateChange(cb: (s: AppLifecycle) => void) {
      const handler = AppState.addEventListener("change", (state) => {
        cb(state === "active" ? "active" : "background");
      });
      return () => handler.remove();
    },
  };
}
