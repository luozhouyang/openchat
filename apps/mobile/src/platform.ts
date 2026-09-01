import { AppState, Platform } from "react-native";
import { deriveWsUrl, type PlatformAdapter } from "platform";
import { createSqliteDatabase, type LocalDatabase } from "state";
import { ExpoSqliteDriver } from "./db/expo-driver";
import { API_URL } from "./lib/config";
import { hydrateSecureCache, secureStorage, tokenStore } from "./lib/secure";

let cachedDb: Promise<LocalDatabase> | null = null;

/** expo-sqlite is always present on device: no degradation chain. */
function openLocalDatabase(): Promise<LocalDatabase> {
  cachedDb ??= (async () => {
    const db = createSqliteDatabase(new ExpoSqliteDriver());
    await db.migrate();
    return db;
  })();
  return cachedDb;
}

export function createMobilePlatform(): PlatformAdapter {
  // Warm the sync StorageAdapter cache (SecureStore is async-only).
  void hydrateSecureCache();
  return {
    platform: Platform.OS === "ios" ? "ios" : "android",
    apiBaseUrl: API_URL,
    wsUrl: deriveWsUrl(API_URL),
    getSessionToken: () => tokenStore.get(),
    setSessionToken: (token) => (token === null ? tokenStore.clear() : tokenStore.set(token)),
    storage: secureStorage,
    openLocalDatabase,
    usesHashRouting: false,
    notify: () => false, // in-app notification taps are handled by expo-notifications
    onAppStateChange(cb) {
      const handler = AppState.addEventListener("change", (state) => {
        cb(state === "active" ? "active" : "background");
      });
      return () => handler.remove();
    },
  } satisfies PlatformAdapter;
}
