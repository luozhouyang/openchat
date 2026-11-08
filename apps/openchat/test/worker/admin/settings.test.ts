import { env, exports } from "cloudflare:workers";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { getDb } from "@worker/db/client";
import { users } from "@worker/db/schema-d1";
import { setRegistrationMode } from "@worker/db/repos/settings";

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

function getSettings(cookie: string) {
  return exports.default.fetch("http://localhost/api/v1/admin/settings", {
    headers: { cookie },
  });
}

function putSettings(cookie: string, registrationMode: string) {
  return exports.default.fetch("http://localhost/api/v1/admin/settings", {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ registrationMode }),
  });
}

let adminCookie = "";
let plainCookie = "";

beforeAll(async () => {
  // The default-mode assertions below must not depend on earlier runs.
  await setRegistrationMode(getDb(env.DB), "open");

  const admin = await signup("settings-admin@test.dev");
  await getDb(env.DB).update(users).set({ role: "admin" }).where(eq(users.id, admin.id));
  adminCookie = admin.cookie;

  plainCookie = (await signup("settings-plain@test.dev")).cookie;
});

afterAll(async () => {
  await setRegistrationMode(getDb(env.DB), "open");
});

test("non-admin cannot read admin settings", async () => {
  const res = await getSettings(plainCookie);
  expect(res.status).toBe(403);
});

test("admin settings default to open registration", async () => {
  const res = await getSettings(adminCookie);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ registrationMode: "open", openRegistration: true });
});

test("admin can switch registration to invite", async () => {
  const put = await putSettings(adminCookie, "invite");
  expect(put.status).toBe(200);
  expect(await put.json()).toEqual({ registrationMode: "invite", openRegistration: false });

  const get = await getSettings(adminCookie);
  expect(get.status).toBe(200);
  expect(await get.json()).toEqual({ registrationMode: "invite", openRegistration: false });
});

test("invalid registration mode is rejected", async () => {
  const res = await putSettings(adminCookie, "chaotic");
  expect(res.status).toBe(422);
});
