import { exports } from "cloudflare:workers";

export type TestWorker = typeof exports.default;

export async function startWorker(): Promise<TestWorker> {
  return exports.default;
}

export async function signup(
  worker: TestWorker,
  email: string,
  password = "test-password",
  name?: string,
): Promise<string> {
  const res = await worker.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      name: name ?? email.split("@")[0],
      username: email.split("@")[0],
    }),
  });
  return res.headers.get("set-cookie") ?? "";
}

export async function userIdOf(worker: TestWorker, cookie: string): Promise<string> {
  const me = await worker.fetch("http://localhost/api/v1/users/me", { headers: { cookie } });
  const body = (await me.json()) as { user: { id: string } };
  return body.user.id;
}
