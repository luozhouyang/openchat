import * as SecureStore from "expo-secure-store";
import type { StorageAdapter } from "platform";

const TOKEN_KEY = "openchat.session_token";
const DEVICE_KEY = "openchat.device_id";
const KEYS = [TOKEN_KEY, DEVICE_KEY] as const;

/** Better-auth bearer token persistence (OS keychain / Keystore via SecureStore). */
export const tokenStore = {
  async get(): Promise<string | null> {
    return SecureStore.getItemAsync(TOKEN_KEY);
  },
  async set(token: string): Promise<void> {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    cache.set(TOKEN_KEY, token);
  },
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    cache.delete(TOKEN_KEY);
  },
};

// SecureStore is async-only; the sync StorageAdapter surface is backed by a
// cache that is warmed at platform construction (best-effort — entries not
// yet hydrated read as null; token/deviceId flows use the async tokenStore).
const cache = new Map<string, string>();
let hydrated = false;

export async function hydrateSecureCache(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  for (const key of KEYS) {
    const value = await SecureStore.getItemAsync(key);
    if (value !== null) cache.set(key, value);
  }
}

export const secureStorage: StorageAdapter = {
  get: (key) => cache.get(key) ?? null,
  set: (key, value) => {
    cache.set(key, value);
    void SecureStore.setItemAsync(key, value);
  },
  remove: (key) => {
    cache.delete(key);
    void SecureStore.deleteItemAsync(key);
  },
};

function randomUUID(): string {
  if ("randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-xxxx-4xxx-yxxx`.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function getDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_KEY);
  if (existing) return existing;
  const id = randomUUID();
  await SecureStore.setItemAsync(DEVICE_KEY, id);
  return id;
}
