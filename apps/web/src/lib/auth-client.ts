import { createAuthClient } from "better-auth/react";
import { jwtClient, adminClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [jwtClient(), adminClient()],
});
