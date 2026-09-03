import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite-plus";

// React-app (SPA) unit tests: jsdom + @testing-library/react. Test files carry
// the `// @vitest-environment jsdom` docblock so they also pass under the root
// `vp test` aggregate runner.
export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: "./src/react-app/routes",
      generatedRouteTree: "./src/react-app/routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/react-app", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test/app/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/app/setup.ts"],
  },
});
