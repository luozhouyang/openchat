import { defineConfig } from "vite-plus";

// Push unit tests run standalone in plain node (queue handler logic, no DOM).
// A package-local config keeps them independent of the root aggregate runner,
// whose `test.setupFiles` (apps/openchat app-test setup) resolves relative to
// the repo root and cannot be reached from a package cwd.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
