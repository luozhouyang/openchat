/**
 * Detection for the Electron file:// environment (consumed by lib/platform.ts
 * only). All behavioral differences live in the desktop-file platform
 * adapter — nothing branches on this flag anymore.
 */
import { desktopBridge } from "./desktop-bridge";

export const desktopFileMode: boolean =
  typeof window !== "undefined" &&
  window.location.protocol === "file:" &&
  !!desktopBridge &&
  desktopBridge.serverUrl.length > 0;

/** API origin injected by the Electron main process ("" in the browser). */
export const desktopServerUrl: string = desktopFileMode ? desktopBridge!.serverUrl : "";
