import type { DesktopBridge } from "platform";

export type { DesktopBridge };

declare global {
  interface Window {
    openchatDesktop?: DesktopBridge;
  }
}

export const desktopBridge: DesktopBridge | null =
  typeof window !== "undefined" ? (window.openchatDesktop ?? null) : null;
