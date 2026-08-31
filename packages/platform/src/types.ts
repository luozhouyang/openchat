export type PlatformId = "web" | "ios" | "android" | "desktop";
export type AppLifecycle = "active" | "background";

export interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface PlatformAdapter {
  platform: PlatformId;
  serverUrl: string;
  getAuthToken(): Promise<string | null>;
  storage: StorageAdapter;
  onAppStateChange(cb: (s: AppLifecycle) => void): () => void;
}
