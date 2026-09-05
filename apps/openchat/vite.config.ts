import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite-plus";

// Single Cloudflare Workers project: the Worker (src/worker) and the React SPA
// (src/react-app) are built together. `vite dev` runs the Worker in workerd
// with local binding emulation + frontend HMR; `vite build` emits the worker
// bundle and `dist/client` static assets; `wrangler deploy` ships both.
export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: "./src/react-app/routes",
      generatedRouteTree: "./src/react-app/routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
    cloudflare(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/react-app", import.meta.url)),
      "@worker": fileURLToPath(new URL("./src/worker", import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
  fmt: {
    ignorePatterns: ["src/react-app/routeTree.gen.ts"],
  },
});
