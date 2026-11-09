import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/**
 * node:sqlite on Node 22 only accepts number/bigint/string/null/Uint8Array;
 * normalize `undefined` to NULL and booleans to 0/1.
 */
function bindable(params: unknown[]): SQLInputValue[] {
  return params.map((value) => {
    if (value === undefined) {
      return null;
    }
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }
    return value;
  }) as SQLInputValue[];
}

export interface SqliteRow {
  [key: string]: unknown;
}

export interface SqliteDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<void>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  close(): Promise<void>;
}

export class NodeSqliteDriver implements SqliteDriver {
  private db: DatabaseSync;

  constructor(filename = ":memory:") {
    this.db = new DatabaseSync(filename);
  }

  async exec(sql: string) {
    this.db.exec(sql);
  }
  async run(sql: string, params: unknown[] = []) {
    this.db.prepare(sql).run(...bindable(params));
  }
  async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...bindable(params)) as T[];
  }
  async get<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T | undefined> {
    return this.db.prepare(sql).get(...bindable(params)) as T | undefined;
  }
  async close() {
    this.db.close();
  }
}
