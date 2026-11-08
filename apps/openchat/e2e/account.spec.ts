import { expect, test } from "@playwright/test";
import { createChannel, createTeam, loginAs, signupUser } from "./fixtures";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("forgot-password page always shows the generic confirmation", async ({ page }) => {
  await page.goto("/auth/forgot-password");
  await page.getByLabel("Email").fill(`missing-${Date.now()}@test.dev`);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("If that email exists, a reset link is on its way.")).toBeVisible({
    timeout: 15_000,
  });
});

test("profile name and avatar can be edited from settings", async ({ page, request }) => {
  const email = `account-${Date.now()}@test.dev`;
  const user = await signupUser(request, email, "Password123!");
  const team = await createTeam(request, user.token, `account-team-${Date.now()}`);
  await createChannel(request, user.token, team.id, `account-${Date.now()}`);
  await loginAs(page, email, "Password123!");
  await expect(page.getByPlaceholder(/Enter to send/)).toBeVisible();

  await page.goto("/settings");
  await page.getByLabel("Display name").fill("Account Tester");
  await page.getByLabel("Nickname").fill("acct");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.locator('img[src*="/avatar"]')).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await expect(page.getByLabel("Display name")).toHaveValue("Account Tester");
  await expect(page.getByLabel("Nickname")).toHaveValue("acct");
});
