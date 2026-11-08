import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";
import { reactAppAlias, spaPlugins } from "./vite.shared";

// Single Cloudflare Workers project: the Worker (src/worker) and the React SPA
// (src/react-app) are built together. `vite dev` runs the Worker in workerd
// with local binding emulation + frontend HMR; `vite build` emits the worker
// bundle and `dist/client` static assets; `wrangler deploy` ships both.
export default defineConfig({
  plugins: [...spaPlugins(), cloudflare()],
  resolve: {
    alias: {
      "@": reactAppAlias["@"],
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
