import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "openchat.session_token";
const DEVICE_KEY = "openchat.device_id";

/** Better-auth bearer token persistence (OS keychain / Keystore via SecureStore). */
export const tokenStore = {
  async get(): Promise<string | null> {
    return SecureStore.getItemAsync(TOKEN_KEY);
  },
  async set(token: string): Promise<void> {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  },
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
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
