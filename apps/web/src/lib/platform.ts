import type { PlatformAdapter } from "platform";
import { createDesktopFilePlatform } from "../platform/desktop-file";
import { createWebPlatform } from "../platform/web";
import { authClient } from "./auth-client";
import { desktopBridge } from "./desktop-bridge";
import { desktopFileMode, desktopServerUrl, getDesktopWsJwt } from "./desktop-mode";

/**
 * Constructed once at module load: the Electron file:// shell gets its own
 * platform implementation, everything else runs the browser (cookie) one.
 */
export const platform: PlatformAdapter = desktopFileMode
  ? createDesktopFilePlatform({ serverUrl: desktopServerUrl, bridge: desktopBridge! })
  : createWebPlatform();

/**
 * Transitional WS upgrade token (better-auth JWT) until the shared auth
 * service owns it (P12-C): browser mode reads the jwt plugin client, the
 * file:// shell exchanges the bridge session token.
 */
export function getWsToken(): Promise<string | null> {
  return desktopFileMode
    ? getDesktopWsJwt()
    : authClient.token().then((r) => r.data?.token ?? null);
}
