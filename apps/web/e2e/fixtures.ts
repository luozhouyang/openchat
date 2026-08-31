import { expect, type APIRequestContext, type Page } from "@playwright/test";

// The real API Worker (wrangler dev / miniflare) used by the e2e webServer.
const API = "http://localhost:8787";

export interface TestUser {
  email: string;
  password: string;
  /** better-auth bearer token (bearer plugin) for REST fixtures. */
  token: string;
}

export async function signupUser(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<TestUser> {
  const res = await request.post(`${API}/api/auth/sign-up/email`, {
    data: { email, password, name: email.split("@")[0] },
  });
  expect(res.ok(), `signup failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { token?: string };
  expect(body.token, "sign-up response must carry a bearer token").toBeTruthy();
  return { email, password, token: body.token! };
}

export async function createTeam(
  request: APIRequestContext,
  token: string,
  displayName: string,
): Promise<{ id: string }> {
  const res = await request.post(`${API}/api/v1/teams`, {
    headers: { authorization: `Bearer ${token}` },
    data: { name: displayName.toLowerCase(), displayName, type: "open" },
  });
  expect(res.ok(), `create team failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string };
}

export async function createChannel(
  request: APIRequestContext,
  token: string,
  teamId: string,
  name: string,
): Promise<{ id: string }> {
  const res = await request.post(`${API}/api/v1/channels`, {
    headers: { authorization: `Bearer ${token}` },
    data: { teamId, name, displayName: name, type: "public" },
  });
  expect(res.ok(), `create channel failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string };
}

export async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByPlaceholder("邮箱").fill(email);
  await page.getByPlaceholder("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
}
