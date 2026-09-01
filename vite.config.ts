import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["**/routeTree.gen.ts", "**/.vite/**", "**/release/**"],
  },
  lint: {
    ignorePatterns: ["**/routeTree.gen.ts", "**/.vite/**", "**/release/**"],
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
