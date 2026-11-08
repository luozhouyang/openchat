import { defineConfig } from "vite-plus";
import { reactAppAlias, spaPlugins } from "./vite.shared";

// React-app (SPA) unit tests: jsdom + @testing-library/react. Test files carry
// the `// @vitest-environment jsdom` docblock so they also pass under the root
// `vp test` aggregate runner.
export default defineConfig({
  plugins: [...spaPlugins()],
  resolve: {
    alias: {
      "@": reactAppAlias["@"],
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test/app/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/app/setup.ts"],
  },
});
