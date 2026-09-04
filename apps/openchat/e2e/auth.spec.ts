import { expect, test } from "@playwright/test";
import { createChannel, createTeam, loginAs, signupUser } from "./fixtures";

let seq = Date.now();

test("signs up via the UI and lands on the check-email page", async ({ page }) => {
  const email = `auth-${seq++}@test.dev`;
  await page.goto("/auth/signup");
  await page.getByLabel("Name", { exact: true }).fill("Auth Tester");
  await page.getByLabel("Username").fill(email.split("@")[0]);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Password123!");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/auth\/check-email/, { timeout: 15_000 });
  await expect(page.getByText(email)).toBeVisible();
});

test("shows an error for a wrong password on login", async ({ page, request }) => {
  const email = `auth-fail-${seq++}@test.dev`;
  await signupUser(request, email, "Password123!");
  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("WrongPassword!");
  await page.getByRole("button", { name: "Sign in" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(alert).toContainText("Sign-in failed");
});

test("logs in and lands in the workspace channel view", async ({ page, request }) => {
  const email = `auth-ok-${seq++}@test.dev`;
  const user = await signupUser(request, email, "Password123!");
  const team = await createTeam(request, user.token, `auth-team-${seq}`);
  const channel = await createChannel(request, user.token, team.id, `general-${seq}`);
  await loginAs(page, email, "Password123!");
  await expect(page).toHaveURL(new RegExp(`/${team.id}/c/${channel.id}`), { timeout: 15_000 });
  await expect(page.getByPlaceholder("输入消息…")).toBeVisible();
});

test("verify-email page shows the success state", async ({ page }) => {
  await page.goto("/auth/verify-email");
  await expect(page.getByText("Email verified")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enter workspace" })).toBeVisible();
});

test("verify-email page shows the failure state with a resend action", async ({ page }) => {
  const email = `auth-verify-${seq++}@test.dev`;
  await page.goto(`/auth/verify-email?error=INVALID_TOKEN&email=${encodeURIComponent(email)}`);
  await expect(page.getByText("Verification failed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Resend verification email" })).toBeVisible();
});
