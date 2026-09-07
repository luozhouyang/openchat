import type { Db } from "@worker/db/types";

// Db is the drizzle-orm class type; the raw D1Database handle is only attached
// to the value returned by drizzle() (getDb), so widen locally to reach it for
// raw FTS SQL that the query builder cannot express.
type DbWithRawClient = Db & { $client: D1Database };

export interface UserSearchProfile {
  id: string;
  username: string | null;
  nickname: string | null;
  name: string | null;
  avatarUrl: string | null;
}

/** Turns free text into an FTS5 prefix query (per-token AND). */
export function ftsQueryFor(term: string): string {
  return term
    .trim()
    .split(/\s+/)
    .map((tok) => tok.replace(/[":*^(){}~!<>-]/g, " ").trim())
    .filter(Boolean)
    .map((tok) => `${tok}*`)
    .join(" ");
}

/**
 * Global full-text user search over the user_fts virtual table. user_fts
 * rowid mirrors users.rowid (integer; FTS5 rowid is integer-only), so we
 * join back to users to resolve the text user id. Returns profiles WITHOUT
 * email.
 */
export async function searchUsers(
  db: Db,
  term: string,
  opts: { limit: number; excludeUserId?: string } = { limit: 20 },
): Promise<UserSearchProfile[]> {
  const query = ftsQueryFor(term);
  if (!query) {
    return [];
  }
  const rows = await (db as DbWithRawClient).$client
    .prepare(
      `SELECT u.id AS id, u.username AS username, u.nickname AS nickname,
              u.name AS name, u.avatar_url AS avatarUrl
       FROM user_fts f
       JOIN users u ON u.rowid = f.rowid
       WHERE user_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .bind(query, opts.limit)
    .all<UserSearchProfile>();
  return rows.results.filter((r) => r.id !== opts.excludeUserId);
}
