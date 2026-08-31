import { expect, test } from "vite-plus/test";
import { env } from "cloudflare:test";
import { getDb } from "../../src/db/client.ts";
import {
  getPreference,
  setPreference,
  listPreferences,
  deletePreference,
} from "../../src/db/repos/preferences.ts";

const db = getDb(env.DB);

test("setPreference inserts then upserts on conflict", async () => {
  await setPreference(db, {
    userId: "user-pref-1",
    category: "theme",
    name: "mode",
    value: "dark",
  });
  expect(
    (await getPreference(db, { userId: "user-pref-1", category: "theme", name: "mode" }))?.value,
  ).toBe("dark");

  await setPreference(db, {
    userId: "user-pref-1",
    category: "theme",
    name: "mode",
    value: "light",
  });
  const rows = await listPreferences(db, "user-pref-1");
  expect(rows).toHaveLength(1);
  expect(rows[0]?.value).toBe("light");
});

test("listPreferences returns only rows for the user", async () => {
  await setPreference(db, { userId: "user-pref-2", category: "notify", name: "all", value: "1" });
  await setPreference(db, { userId: "user-pref-3", category: "notify", name: "all", value: "0" });
  const rows = await listPreferences(db, "user-pref-2");
  expect(rows).toHaveLength(1);
  expect(rows[0]?.userId).toBe("user-pref-2");
});

test("deletePreference removes the row", async () => {
  await setPreference(db, { userId: "user-pref-4", category: "locale", name: "lang", value: "en" });
  await deletePreference(db, { userId: "user-pref-4", category: "locale", name: "lang" });
  expect(
    await getPreference(db, { userId: "user-pref-4", category: "locale", name: "lang" }),
  ).toBeNull();
});
