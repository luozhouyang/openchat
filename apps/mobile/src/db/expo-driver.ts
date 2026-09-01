import * as SQLite from "expo-sqlite";
import type { SqliteDriver } from "state";

/**
 * expo-sqlite backed SqliteDriver. Uses the async database handle so the
 * all-Promise SqliteDriver contract holds; SQL strings come from the shared
 * packages/state schema module, identical to web/desktop.
 */
export class ExpoSqliteDriver implements SqliteDriver {
  private db: SQLite.SQLiteDatabase | null = null;

  constructor(private filename = "openchat.db") {}

  private async ensureDb(): Promise<SQLite.SQLiteDatabase> {
    if (!this.db) {
      this.db = await SQLite.openDatabaseAsync(this.filename);
    }
    return this.db;
  }

  async exec(sql: string) {
    const db = await this.ensureDb();
    await db.execAsync(sql);
  }

  async run(sql: string, params: unknown[] = []) {
    const db = await this.ensureDb();
    await db.runAsync(sql, params as SQLite.SQLiteBindParams);
  }

  async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const db = await this.ensureDb();
    return db.getAllAsync<T>(sql, params as SQLite.SQLiteBindParams);
  }

  async get<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T | undefined> {
    const db = await this.ensureDb();
    return (await db.getFirstAsync<T>(sql, params as SQLite.SQLiteBindParams)) ?? undefined;
  }

  async close() {
    await this.db?.closeAsync();
    this.db = null;
  }
}
