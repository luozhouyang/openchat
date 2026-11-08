import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createChannel, createTeam, loginAs, signupUser } from "./fixtures";

async function setupWorkspace(page: Page, request: APIRequestContext, prefix: string) {
  const stamp = Date.now();
  const email = `${prefix}-${stamp}@test.dev`;
  const user = await signupUser(request, email, "Password123!");
  const team = await createTeam(request, user.token, `${prefix}-team-${stamp}`);
  await createChannel(request, user.token, team.id, `${prefix}-${stamp}`);
  await loginAs(page, email, "Password123!");
  await expect(page.getByPlaceholder(/Enter to send/)).toBeVisible();
}

function messageRow(page: Page, text: string) {
  return page
    .getByText(text)
    .locator(
      "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' group ')][1]",
    );
}

test("theme choice persists across reloads", async ({ page, request }) => {
  await setupWorkspace(page, request, "theme");
  await page.goto("/settings");
  await page.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("pinning a message shows it in the pinned dialog", async ({ page, request }) => {
  await setupWorkspace(page, request, "pins");
  const composer = page.getByPlaceholder(/Enter to send/);
  await composer.fill("pin this message");
  await composer.press("Enter");

  const row = messageRow(page, "pin this message");
  await expect(row).toBeVisible();
  await row.hover();
  await row.getByRole("button", { name: "Pin", exact: true }).click();

  await page.getByRole("button", { name: "Pinned messages" }).click();
  await expect(page.getByRole("dialog").getByText("pin this message")).toBeVisible();
});

test("replying opens the thread panel and posts a reply", async ({ page, request }) => {
  await setupWorkspace(page, request, "threads");
  const composer = page.getByPlaceholder(/Enter to send/);
  await composer.fill("thread root");
  await composer.press("Enter");

  const row = messageRow(page, "thread root");
  await expect(row).toBeVisible();
  await row.hover();
  await row.getByRole("link", { name: "Reply", exact: true }).click();
  await expect(page).toHaveURL(/\/t\//);

  const threadInput = page.getByPlaceholder("Reply to thread…");
  await threadInput.fill("thread answer");
  await threadInput.press("Enter");
  await expect(page.getByText("thread answer")).toBeVisible();
});
