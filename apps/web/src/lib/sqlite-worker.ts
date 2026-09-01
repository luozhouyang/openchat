import sqlite3InitModule, { type BindingSpec, type Database } from "@sqlite.org/sqlite-wasm";

export type SqliteWorkerCall =
  | { kind: "open"; filename: string }
  | { kind: "exec"; sql: string }
  | { kind: "run"; sql: string; params: unknown[] }
  | { kind: "all"; sql: string; params: unknown[] }
  | { kind: "close" };

export type SqliteWorkerRequest = SqliteWorkerCall & { id: number };

export type SqliteWorkerResponse =
  | { id: number; ok: true; rows?: Record<string, unknown>[] }
  | { id: number; ok: false; error: string };

let db: Database | null = null;

async function open(filename: string) {
  const sqlite3 = await sqlite3InitModule();
  const pool = await sqlite3.installOpfsSAHPoolVfs({});
  db = new pool.OpfsSAHPoolDb(filename);
}

async function handle(call: SqliteWorkerCall): Promise<{ rows?: Record<string, unknown>[] }> {
  switch (call.kind) {
    case "open":
      await open(call.filename);
      return {};
    case "exec":
      db!.exec(call.sql);
      return {};
    case "run":
      run(db!, call.sql, call.params);
      return {};
    case "all":
      return { rows: all(db!, call.sql, call.params) };
    case "close":
      db?.close();
      db = null;
      return {};
  }
}

// bind([]) on a statement with zero placeholders throws ("no bindable
// parameters"), e.g. SELECT DISTINCT channel_id — skip binding instead.
function bindParams(stmt: { bind(spec: BindingSpec): void }, params: unknown[]) {
  if (params.length > 0) stmt.bind(params as BindingSpec);
}

function run(db: Database, sql: string, params: unknown[]) {
  const stmt = db.prepare(sql);
  try {
    bindParams(stmt, params);
    stmt.stepFinalize();
  } finally {
    stmt.finalize();
  }
}

function all(db: Database, sql: string, params: unknown[]): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  try {
    bindParams(stmt, params);
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) rows.push(stmt.get({}) as Record<string, unknown>);
    return rows;
  } finally {
    stmt.finalize();
  }
}

const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent<SqliteWorkerRequest>) => void) | null;
  postMessage: (msg: SqliteWorkerResponse) => void;
};

ctx.onmessage = (ev) => {
  const req = ev.data;
  handle(req).then(
    (out) => ctx.postMessage({ id: req.id, ok: true, ...out }),
    (e: unknown) =>
      ctx.postMessage({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) }),
  );
};
