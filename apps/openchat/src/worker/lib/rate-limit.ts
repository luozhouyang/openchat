import type { MiddlewareHandler } from "hono";
import type { SessionContext } from "@worker/auth/session";
import { apiError } from "@worker/lib/errors";

interface Window {
  count: number;
  resetAt: number;
}

/** Per-isolate fixed windows; bounded so a hostile key space cannot grow forever. */
const buckets = new Map<string, Window>();
const MAX_BUCKETS = 10_000;

export interface RateLimitOptions {
  /** Logical bucket, e.g. "search". */
  bucket: string;
  limit: number;
  windowMs: number;
}

export function createRateLimit(opts: RateLimitOptions): MiddlewareHandler<{
  Bindings: Env;
  Variables: { session: SessionContext };
}> {
  return async (c, next) => {
    const userId = c.get("session")?.user.id;
    const key = `${opts.bucket}:${userId ?? c.req.header("cf-connecting-ip") ?? "anonymous"}`;
    const now = Date.now();
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      if (buckets.size >= MAX_BUCKETS) {
        buckets.clear();
      }
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      await next();
      return;
    }
    if (current.count >= opts.limit) {
      throw apiError("rate limited", "rate_limited", 429);
    }
    current.count += 1;
    await next();
  };
}
