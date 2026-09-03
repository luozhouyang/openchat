import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema-d1.ts";
import type { Db } from "./types.ts";

export function getDb(database: D1Database): Db {
  return drizzle(database, { schema });
}
export type { Db };
