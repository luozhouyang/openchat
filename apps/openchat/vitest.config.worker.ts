import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vite-plus";

// Worker tests: run inside workerd via @cloudflare/vitest-plugin with local D1
// migrations applied. Run via `vp run openchat#test` (never root `vp test`).

// SQLite probes SQLITE_TMPDIR/TMPDIR before /var/tmp, and sandboxes that deny
// /var/tmp make D1 fail with SQLITE_CANTOPEN. Pin the temp dir for the workerd
// child before Miniflare spawns it.
process.env.SQLITE_TMPDIR ??= os.tmpdir();
export default defineConfig(async () => {
  const migrationsPath = path.join(import.meta.dirname, "migrations", "d1");
  const migrations = await readD1Migrations(migrationsPath);

  return {
    plugins: [
      cloudflareTest({
        wrangler: {
          configPath: "./wrangler.jsonc",
        },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    resolve: {
      alias: {
        "@worker": fileURLToPath(new URL("./src/worker", import.meta.url)),
      },
    },
    test: {
      include: ["test/worker/**/*.test.ts"],
      setupFiles: ["./test/worker/apply-migrations.ts"],
    },
  };
});
