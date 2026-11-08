import { exports } from "cloudflare:workers";
import { expect, test } from "vite-plus/test";
import { signup } from "../helpers/setup.ts";

const SEARCH_LIMIT = 20;

type SearchBody = { hits: unknown[]; error?: string };

async function search(cookie: string): Promise<{ status: number; body: SearchBody }> {
  const res = await exports.default.fetch("http://localhost/api/v1/search?q=foo", {
    headers: { cookie },
  });
  return {
    status: res.status,
    body: (await res.json()) as SearchBody,
  };
}

test("search requests are rate limited per user", async () => {
  // A fresh user gets a fresh bucket: limiter windows are per isolate and keyed
  // by user id, so this test does not share state with other route tests.
  const cookie = await signup(
    exports.default,
    "rate-limit-search@test.dev",
    "rate-limit-password",
    "Rate Limit",
  );
  expect(cookie).not.toBe("");

  for (let attempt = 1; attempt <= SEARCH_LIMIT; attempt += 1) {
    const { status, body } = await search(cookie);
    expect(status).toBe(200);
    expect(body.hits).toEqual([]);
  }

  const limited = await search(cookie);
  expect(limited.status).toBe(429);
  expect(limited.body.error).toBe("rate_limited");
});
