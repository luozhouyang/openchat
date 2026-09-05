import { expect, type APIRequestContext, type Page } from "@playwright/test";

// Same-origin by default: vite preview serves both the Worker (API) and the
// SPA. Desktop e2e points E2E_API_URL at its own wrangler dev (:8787).
// better-auth requires an Origin header on POSTs; Playwright's
// APIRequestContext does not send one, so the fixtures set it explicitly.
export const API = process.env.E2E_API_URL ?? "http://localhost:4173";
const ORIGIN = { origin: API };

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
  const username = email.split("@")[0];
  const res = await request.post(`${API}/api/auth/sign-up/email`, {
    headers: ORIGIN,
    data: { email, password, name: username, username },
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
    headers: { authorization: `Bearer ${token}`, ...ORIGIN },
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
    headers: { authorization: `Bearer ${token}`, ...ORIGIN },
    data: { teamId, name, displayName: name, type: "public" },
  });
  expect(res.ok(), `create channel failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string };
}

export async function joinTeam(
  request: APIRequestContext,
  token: string,
  teamId: string,
): Promise<void> {
  const res = await request.post(`${API}/api/v1/teams/${teamId}/members`, {
    headers: { authorization: `Bearer ${token}`, ...ORIGIN },
    data: {},
  });
  expect(res.ok(), `join team failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

export async function joinChannel(
  request: APIRequestContext,
  token: string,
  channelId: string,
): Promise<void> {
  const res = await request.post(`${API}/api/v1/channels/${channelId}/members`, {
    headers: { authorization: `Bearer ${token}`, ...ORIGIN },
    data: {},
  });
  expect(res.ok(), `join channel failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

export async function userIdOf(request: APIRequestContext, token: string): Promise<string> {
  const res = await request.get(`${API}/api/v1/users/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `users/me failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { user: { id: string } }).user.id;
}

export async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}
