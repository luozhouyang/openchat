import type { SqliteDriver } from "state";
import type { SqliteWorkerCall, SqliteWorkerResponse } from "./sqlite-worker";

interface Pending {
  resolve: (res: Extract<SqliteWorkerResponse, { ok: true }>) => void;
  reject: (e: Error) => void;
}

export class SqliteWasmDriver implements SqliteDriver {
  private filename: string;
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private readyPromise: Promise<void> | null = null;

  constructor(filename = "openchat.db") {
    this.filename = filename;
  }

  /** Spawns the worker and verifies the persistent VFS is usable. Rejects when unavailable. */
  ready(): Promise<void> {
    this.readyPromise ??= this.request({ kind: "open", filename: this.filename }).then(
      () => undefined,
    );
    return this.readyPromise;
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      const w = new Worker(new URL("./sqlite-worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (ev: MessageEvent<SqliteWorkerResponse>) => {
        const p = this.pending.get(ev.data.id);
        if (!p) {
          return;
        }
        this.pending.delete(ev.data.id);
        if (ev.data.ok) {
          p.resolve(ev.data);
        } else {
          p.reject(new Error(ev.data.error));
        }
      };
      w.onerror = (ev) => {
        const err = new Error(ev.message || "sqlite worker crashed");
        for (const p of this.pending.values()) {
          p.reject(err);
        }
        this.pending.clear();
      };
      this.worker = w;
    }
    return this.worker;
  }

  private request(call: SqliteWorkerCall): Promise<Extract<SqliteWorkerResponse, { ok: true }>> {
    const w = this.ensureWorker();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ ...call, id });
    });
  }

  async exec(sql: string) {
    await this.request({ kind: "exec", sql });
  }
  async run(sql: string, params: unknown[] = []) {
    await this.request({ kind: "run", sql, params });
  }
  async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.request({ kind: "all", sql, params });
    return (res.rows ?? []) as T[];
  }
  async get<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T | undefined> {
    const rows = await this.all<T>(sql, params);
    return rows[0];
  }
  async close() {
    if (!this.worker) {
      return;
    }
    await this.request({ kind: "close" }).catch(() => {});
    this.worker.terminate();
    this.worker = null;
    this.readyPromise = null;
  }
}
