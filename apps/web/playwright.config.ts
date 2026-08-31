import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://localhost:4173" },
  webServer: [
    // Real API Worker on local miniflare (wrangler dev), with local D1 migrated first.
    {
      command:
        "cd ../api && ./node_modules/.bin/wrangler d1 migrations apply DB --local && ./node_modules/.bin/wrangler dev",
      port: 8787,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    // Built web assets served by vite preview (proxy /api + /ws to :8787).
    {
      command: "vp run web#build && vp run web#preview",
      port: 4173,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
