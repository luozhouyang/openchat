import { createWebPlatform } from "platform";
import { authClient } from "./auth-client";
import { desktopFileMode, desktopServerUrl, getDesktopWsJwt } from "./desktop-mode";

function wsUrl(origin: string): string {
  return `${origin.replace(/^http/, "ws")}/ws`;
}

export const platform = createWebPlatform(
  desktopFileMode
    ? {
        // file:// has no usable window.location: the Electron main process
        // injects the API origin via the preload bridge.
        serverUrl: wsUrl(desktopServerUrl),
        getAuthToken: () => getDesktopWsJwt(),
      }
    : {
        getAuthToken: async () => (await authClient.token()).data?.token ?? null,
      },
);
