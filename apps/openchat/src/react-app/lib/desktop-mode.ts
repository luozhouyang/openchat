/**
 * Detection for the Electron bundled renderer (consumed by lib/platform.ts
 * only): a non-http(s) origin (the privileged app:// scheme). The API origin
 * arrives as the ?api= query parameter (written by the shell's loadURL) so
 * detection never depends on the preload bridge's injection timing; the
 * bridge still backs tokens/notifications at runtime. Remote-renderer
 * desktop mode keeps its https origin and cookie sessions. All behavioral
 * differences live in the desktop-file platform adapter.
 */
import { desktopBridge } from "./desktop-bridge";

export const desktopFileMode: boolean =
  typeof window !== "undefined" && !/^https?:$/.test(window.location.protocol);

/** API origin injected by the Electron main process ("" in the browser). */
export const desktopServerUrl: string = desktopFileMode
  ? (new URLSearchParams(window.location.search).get("api") ?? desktopBridge?.serverUrl ?? "")
  : "";
