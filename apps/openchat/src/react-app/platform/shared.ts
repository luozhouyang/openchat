import type { AppLifecycle } from "platform";
import { createMemoryDatabase, createSqliteDatabase, type LocalDatabase } from "state";

/**
 * Browser openLocalDatabase: SQLite WASM (opfs-sahpool Worker) with an
 * in-memory, session-scoped fallback when Worker/OPFS is unavailable. The
 * degradation chain is web-platform policy — it lives here, not in state.
 */
let cached: Promise<LocalDatabase> | null = null;

export function openLocalDatabase(): Promise<LocalDatabase> {
  cached ??= create();
  return cached;
}

async function create(): Promise<LocalDatabase> {
  try {
    if (typeof Worker === "undefined") {
      throw new Error("workers unavailable");
    }
    const { SqliteWasmDriver } = await import("../lib/sqlite-wasm-driver");
    const driver = new SqliteWasmDriver();
    await driver.ready();
    const db = createSqliteDatabase(driver);
    await db.migrate();
    return db;
  } catch {
    return createMemoryDatabase();
  }
}

export function visibilityAppState(cb: (s: AppLifecycle) => void): () => void {
  const handler = () => cb(document.visibilityState === "hidden" ? "background" : "active");
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}
