import type { SqliteDriver } from "./driver.ts";

/**
 * Nesting-safe transaction runner: BEGIN/COMMIT at depth 0, inner calls join
 * the outer transaction. Shared by LocalDatabase.transaction() and
 * repositories so a service wrapping several repository calls in one
 * transaction never hits "cannot start a transaction within a transaction".
 */
export class SqliteTxRunner {
  private depth = 0;

  constructor(private readonly d: SqliteDriver) {}

  get inTransaction(): boolean {
    return this.depth > 0;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.depth > 0) return fn(); // join the outer transaction
    this.depth++;
    await this.d.exec("BEGIN");
    try {
      const result = await fn();
      await this.d.exec("COMMIT");
      return result;
    } catch (err) {
      try {
        await this.d.exec("ROLLBACK");
      } catch {
        // connection-level failure: the transaction is gone either way
      }
      throw err;
    } finally {
      this.depth--;
    }
  }
}
