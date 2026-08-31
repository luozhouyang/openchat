import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "jsdom",
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  fmt: {},
});
