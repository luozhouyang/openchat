import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite-plus";

// Desktop renderer build: produces ONLY the React SPA (no Cloudflare Worker).
// Consumed by apps/desktop (electron-builder packages web-dist/**). The base
// is "./" and outDir is set via CLI (--base ./ --outDir ../desktop/.vite/build/web-dist).
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
  optimizeDeps: {
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
});
