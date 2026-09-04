import type { PlatformAdapter } from "platform";
import { createDesktopFilePlatform } from "@/platform/desktop-file";
import { createWebPlatform } from "@/platform/web";
import { desktopBridge } from "./desktop-bridge";
import { desktopFileMode, desktopServerUrl } from "./desktop-mode";

/**
 * Constructed once at module load — the ONLY place in the web app that knows
 * the desktop shell exists: the Electron file:// environment gets its own
 * platform implementation, everything else runs the browser (cookie) one.
 */
export const platform: PlatformAdapter = desktopFileMode
  ? createDesktopFilePlatform({ serverUrl: desktopServerUrl, bridge: desktopBridge! })
  : createWebPlatform();
