import { drizzle } from "drizzle-orm/d1";
import * as schema from "@worker/db/schema-d1";
import type { Db } from "@worker/db/types";

export function getDb(database: D1Database): Db {
  return drizzle(database, { schema });
}
export type { Db };
