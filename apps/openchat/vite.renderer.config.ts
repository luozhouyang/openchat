import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";
import { reactAppAlias, tanStackRouterPlugin } from "./vite.shared";

// Desktop renderer build: produces ONLY the React SPA (no Cloudflare Worker).
// Consumed by apps/desktop (electron-builder packages web-dist/**). The base
// is "./" and outDir is set via CLI (--base ./ --outDir ../desktop/.vite/build/web-dist).
export default defineConfig({
  plugins: [tanStackRouterPlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": reactAppAlias["@"],
    },
  },
  optimizeDeps: {
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
});
