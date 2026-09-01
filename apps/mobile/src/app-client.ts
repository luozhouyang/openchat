import { createAppClient } from "state";
import { createMobilePlatform } from "./platform";
import { registerPush } from "./lib/push";

/**
 * The mobile app's composition root (P12-D): the shared appClient over the
 * mobile platform, plus the push registration adapter.
 */
export const appClient = createAppClient({
  platform: { ...createMobilePlatform(), push: { register: registerPush } },
});
