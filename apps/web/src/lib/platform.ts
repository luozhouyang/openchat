import { createWebPlatform } from "platform";
import { authClient } from "./auth-client";

export const platform = createWebPlatform({
  getAuthToken: async () => (await authClient.token()).data?.token ?? null,
});
