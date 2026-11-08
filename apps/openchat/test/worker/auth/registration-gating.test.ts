import { env, exports } from "cloudflare:workers";
import { expect, test } from "vite-plus/test";
import { getDb } from "@worker/db/client";
import { getRegistrationMode, setRegistrationMode } from "@worker/db/repos/settings";

async function signup(email: string): Promise<{ res: Response; cookie: string }> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "gating-test-password",
      name: email.split("@")[0],
      username: email.split("@")[0],
    }),
  });
  return { res, cookie: res.headers.get("set-cookie") ?? "" };
}

test("default registration mode is open", async () => {
  expect(await getRegistrationMode(getDb(env.DB))).toBe("open");
});

test("closed mode rejects email sign-up with registration_closed", async () => {
  const db = getDb(env.DB);
  await setRegistrationMode(db, "closed");
  try {
    const { res } = await signup("gating-closed@test.dev");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message?: string; code?: string };
    expect(body.message ?? JSON.stringify(body)).toContain("registration_closed");
  } finally {
    // per-file isolated storage, but restore anyway
    await setRegistrationMode(db, "open");
  }
  const { res: ok } = await signup("gating-open-again@test.dev");
  expect(ok.status).toBe(200);
});

test("invite mode behaves like open at this stage", async () => {
  const db = getDb(env.DB);
  await setRegistrationMode(db, "invite");
  try {
    const { res } = await signup("gating-invite@test.dev");
    expect(res.status).toBe(200);
  } finally {
    await setRegistrationMode(db, "open");
  }
});
