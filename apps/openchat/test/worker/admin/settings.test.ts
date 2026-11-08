import { env, exports } from "cloudflare:workers";
import { expect, test } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { getDb } from "@worker/db/client";
import { users } from "@worker/db/schema-d1";
import { getRegistrationMode, setRegistrationMode } from "@worker/db/repos/settings";

async function signup(email: string): Promise<{ cookie: string; id: string }> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "settings-test-password",
      name: email.split("@")[0],
      username: email.split("@")[0],
    }),
  });
  const cookie = res.headers.get("set-cookie") ?? "";
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie },
  });
  const { user } = (await me.json()) as { user: { id: string } };
  return { cookie, id: user.id };
}

let adminCookie = "";

test("admin settings roundtrip (auth + get/put)", async () => {
  const { cookie, id } = await signup("settings-admin@test.dev");
  await getDb(env.DB).update(users).set({ role: "admin" }).where(eq(users.id, id));
  adminCookie = cookie;

  // non-admin is rejected
  const plain = await signup("settings-plain@test.dev");
  const denied = await exports.default.fetch("http://localhost/api/v1/admin/settings", {
    headers: { cookie: plain.cookie },
  });
  expect(denied.status).toBe(403);

  const initial = await exports.default.fetch("http://localhost/api/v1/admin/settings", {
    headers: { cookie: adminCookie },
  });
  expect(initial.status).toBe(200);
  const initialBody = (await initial.json()) as {
    registrationMode: string;
    openRegistration: boolean;
  };
  expect(initialBody.openRegistration).toBe(initialBody.registrationMode === "open");

  const put = await exports.default.fetch("http://localhost/api/v1/admin/settings", {
    method: "PUT",
    headers: { cookie: adminCookie, "content-type": "application/json" },
    body: JSON.stringify({ registrationMode: "closed" }),
  });
  expect(put.status).toBe(200);
  expect(await getRegistrationMode(getDb(env.DB))).toBe("closed");

  const after = await exports.default.fetch("http://localhost/api/v1/admin/settings", {
    headers: { cookie: adminCookie },
  });
  const afterBody = (await after.json()) as { registrationMode: string; openRegistration: boolean };
  expect(afterBody).toEqual({ registrationMode: "closed", openRegistration: false });

  // invalid mode rejected by validator
  const invalid = await exports.default.fetch("http://localhost/api/v1/admin/settings", {
    method: "PUT",
    headers: { cookie: adminCookie, "content-type": "application/json" },
    body: JSON.stringify({ registrationMode: "chaotic" }),
  });
  // zodValidator rejects unknown enum values with a fixed 4xx client error.
  expect(invalid.status).toBe(422);

  await setRegistrationMode(getDb(env.DB), "open");
});
