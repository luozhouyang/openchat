import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./migrations/channel-do",
  schema: "./src/db/schema-channel-do.ts",
  dialect: "sqlite",
  driver: "durable-sqlite",
});
