// Contract-only package (P12 D11): types + pure helpers. Adapter
// implementations live in each platform app; packages/** stays free of
// platform APIs (no node:*, react-native, expo-*, electron — zero exemptions).
export type {
  AppLifecycle,
  DesktopBridge,
  PlatformAdapter,
  PlatformId,
  PushAdapter,
  StorageAdapter,
} from "./types.ts";
export { deriveWsUrl } from "./types.ts";
