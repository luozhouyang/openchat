import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema-d1.ts";

export function getDb(database: D1Database) {
  return drizzle(database, { schema });
}
