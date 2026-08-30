import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./migrations/user-do",
  schema: "./src/db/schema-user-do.ts",
  dialect: "sqlite",
  driver: "durable-sqlite",
});
