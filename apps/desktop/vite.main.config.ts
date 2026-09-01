import { defineConfig } from "vite";

// Builds the Electron main process as CommonJS (Electron loads it via
// require from package.json "main").
export default defineConfig({
  build: {
    outDir: ".vite/build",
    lib: {
      entry: "src/main.ts",
      formats: ["cjs"],
      fileName: () => "main.js",
    },
    rollupOptions: {
      external: [/^node:/, "electron", "electron-updater"],
    },
  },
});
