import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/** node:sqlite (Node 22) rejects `undefined`; normalize optional bindings to NULL. */
function bindable(params: unknown[]): SQLInputValue[] {
  return params.map((value) => (value === undefined ? null : value)) as SQLInputValue[];
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
