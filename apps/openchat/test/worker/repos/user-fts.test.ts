import { env } from "cloudflare:workers";
import { expect, test } from "vite-plus/test";

const db = () => env.DB;

async function insertUser(
  id: string,
  email: string,
  name: string,
  username: string | null,
  nickname: string | null,
) {
  await db()
    .prepare("INSERT INTO users (id, email, name, username, nickname) VALUES (?, ?, ?, ?, ?)")
    .bind(id, email, name, username, nickname)
    .run();
}

async function hits(token: string): Promise<string[]> {
  const res = await db()
    .prepare(
      "SELECT u.id AS id FROM user_fts f JOIN users u ON u.rowid = f.rowid WHERE user_fts MATCH ? ORDER BY rank LIMIT 20",
    )
    .bind(`${token}*`)
    .all<{ id: string }>();
  return res.results.map((r) => r.id);
}

test("insert syncs a new user into user_fts", async () => {
  await insertUser("fts-1", "onlya1@x.test", "Zed Zed", "zeduser", "NickA");
  expect(await hits("zeduser")).toEqual(["fts-1"]);
  expect(await hits("NickA")).toEqual(["fts-1"]);
});

test("update of a searchable column refreshes the index", async () => {
  await insertUser("fts-2", "onlya2@x.test", "Zed Zed", "olduser", "NickB");
  await db().prepare("UPDATE users SET username = ? WHERE id = ?").bind("newuser", "fts-2").run();
  expect(await hits("newuser")).toEqual(["fts-2"]);
  expect(await hits("olduser")).toEqual([]);
  expect(await hits("NickB")).toEqual(["fts-2"]); // unrelated column untouched
});

test("update of a non-searchable column does not touch the index", async () => {
  await insertUser("fts-3", "onlya3@x.test", "Zed Zed", "keepuser", "NickC");
  await db()
    .prepare("UPDATE users SET avatar_url = ? WHERE id = ?")
    .bind("http://img/x", "fts-3")
    .run();
  expect(await hits("keepuser")).toEqual(["fts-3"]);
  expect(await hits("NickC")).toEqual(["fts-3"]);
});

test("delete removes the user from user_fts", async () => {
  await insertUser("fts-4", "onlya4@x.test", "Zed Zed", "goneuser", null);
  expect(await hits("goneuser")).toEqual(["fts-4"]);
  await db().prepare("DELETE FROM users WHERE id = ?").bind("fts-4").run();
  expect(await hits("goneuser")).toEqual([]);
});
