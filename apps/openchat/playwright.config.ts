import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://localhost:4173" },
  webServer: [
    // Single real Worker: build the SPA + worker, migrate local D1, then
    // preview both API and static assets from vite preview (same origin).
    {
      command:
        "env -u VP_RUN -u VP_RUN_IPC_NAME -u VP_RUN_NODE_CLIENT_PATH -u VP_RAW_SUBCOMMAND vp run openchat#build && ./node_modules/.bin/wrangler d1 migrations apply DB --local && vp run openchat#preview",
      port: 4173,
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
