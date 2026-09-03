import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  webServer: [
    // Real API Worker (miniflare) with local D1 migrated.
    {
      command:
        "cd ../openchat && ./node_modules/.bin/wrangler d1 migrations apply DB --local && ./node_modules/.bin/wrangler dev",
      port: 8787,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    // Web renderer build served by vite preview; the Electron shell loads it.
    {
      command: "vp run openchat#build && vp run openchat#preview",
      port: 4173,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
