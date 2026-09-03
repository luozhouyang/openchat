import { createAppClient } from "state";
import { platform } from "./lib/platform";

/**
 * The web app's composition root (P12-D): one appClient for both web modes
 * (browser cookie / Electron file:// bearer). All mode differences live in
 * the platform adapters — this file knows nothing about desktop.
 */
export const appClient = createAppClient({ platform });
