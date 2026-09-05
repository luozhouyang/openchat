import { MemoryMessageRepository } from "./memory.ts";
import { runMigrations } from "./migrations.ts";
import { MIGRATIONS } from "./schema.ts";
import { SqliteMessageRepository } from "./sqlite.ts";
import { SqliteTxRunner } from "./tx.ts";
import type { SqliteDriver } from "./driver.ts";
import type { MessageRepository } from "./types.ts";

/**
 * The client-side local database: owns driver lifecycle, schema migrations
 * and cross-entity transactions; exposes one repository per entity. The
 * generalization lives here (container), not in per-entity access
 * (repositories stay narrow) — future entities (drafts/outbox/reactions)
 * attach as new properties.
 */
export interface LocalDatabase {
  /** Idempotent; applies pending migrations (no-op for memory). */
  migrate(): Promise<void>;
  /**
   * Runs fn atomically. Inner transaction() calls join the outer one.
   * Cross-entity atomicity (e.g. outbox flush: mark sent + append message +
   * delete outbox row) is the reason this lives on the container.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  messages: MessageRepository;
  close(): Promise<void>;
}

export function createSqliteDatabase(driver: SqliteDriver): LocalDatabase {
  const tx = new SqliteTxRunner(driver);
  const messages = new SqliteMessageRepository(driver, tx);
  let migrated = false;
  return {
    async migrate() {
      if (migrated) {
        return;
      }
      await runMigrations(driver, MIGRATIONS);
      migrated = true;
    },
    transaction<T>(fn: () => Promise<T>): Promise<T> {
      return tx.run(fn);
    },
    messages,
    async close() {
      await driver.close();
    },
  };
}

export function createMemoryDatabase(): LocalDatabase {
  const messages = new MemoryMessageRepository();
  return {
    async migrate() {},
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    },
    messages,
    async close() {
      messages.clear();
    },
  };
}
