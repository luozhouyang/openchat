import { expect, test } from "vite-plus/test";
import { env } from "cloudflare:test";

test("structure tables exist after migration", async () => {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table'",
  ).all<{ name: string }>();
  const names = results.map((r) => r.name);
  for (const table of [
    "teams",
    "team_members",
    "channels",
    "channel_members",
    "integrations",
    "system_settings",
    "preferences",
    "roles",
    "schemes",
    "uploadsessions",
    "fileinfo",
  ]) {
    expect(names).toContain(table);
  }
});
