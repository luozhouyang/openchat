import { createAuthClient } from "better-auth/react";
import { jwtClient, adminClient } from "better-auth/client/plugins";
import { desktopFileMode, desktopServerUrl } from "./desktop-mode";

// Note: in the Electron file:// shell the cookie session does not exist, so
// authClient-backed flows (admin console) are degraded there — the primary
// desktop auth path is the bearer flow in lib/desktop-mode.ts. Pointing
// baseURL at the injected origin at least keeps the client functional for
// token fetches.
export const authClient = createAuthClient({
  baseURL: desktopFileMode
    ? desktopServerUrl
    : /^https?:$/.test(window.location.protocol)
      ? window.location.origin
      : undefined,
  plugins: [jwtClient(), adminClient()],
});
