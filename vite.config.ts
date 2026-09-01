import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["**/routeTree.gen.ts", "**/.vite/**", "**/release/**", "**/web-dist/**"],
  },
  // Mirrors apps/web's `@ → src` alias so its component tests resolve UI
  // imports under the root aggregate runner as well.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  // Root `vp test` runs plain-Vitest suites only (shared packages + web /
  // desktop / push unit tests). Suites that need their own runner are excluded
  // here and invoked via their package scripts (see AGENTS.md):
  //   apps/api     — Cloudflare vitest plugin + D1 migrations → `vp run api#test`
  //   apps/mobile  — jest-expo standalone workspace           → `cd apps/mobile && corepack pnpm test`
  //   */e2e        — Playwright / Maestro                     → `vp run web#e2e` / `vp run desktop#e2e`
  test: {
    exclude: [
      "**/node_modules/**",
      "apps/api/**",
      "apps/mobile/**",
      "apps/web/e2e/**",
      "apps/desktop/e2e/**",
      "apps/desktop/.vite/**",
      "apps/desktop/release/**",
    ],
  },
  lint: {
    ignorePatterns: ["**/routeTree.gen.ts", "**/.vite/**", "**/release/**", "**/web-dist/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        files: ["packages/realtime/**", "packages/state/**", "packages/platform/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: ["node:*", "react-native", "expo-*", "electron"],
                  message:
                    "shared packages must stay platform-free; inject platform concerns via adapters",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["packages/state/src/db/driver.ts"],
        rules: { "no-restricted-imports": "off" },
      },
    ],
  },
  run: {
    cache: true,
  },
});
