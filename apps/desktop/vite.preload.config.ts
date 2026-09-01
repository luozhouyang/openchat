import { defineConfig } from "vite";

// Builds the sandboxed preload script as CommonJS.
export default defineConfig({
  build: {
    outDir: ".vite/build",
    emptyOutDir: false,
    lib: {
      entry: "src/preload.ts",
      formats: ["cjs"],
      fileName: () => "preload.js",
    },
    rollupOptions: {
      external: [/^node:/, "electron"],
    },
  },
});
