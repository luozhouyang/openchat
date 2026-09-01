import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**", "**/.{idea,git,cache,output,temp}/**"],
  },
});
