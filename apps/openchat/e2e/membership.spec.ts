import { expect, test } from "@playwright/test";
import { createChannel, createTeam, joinChannel, joinTeam, loginAs, signupUser } from "./fixtures";

test("members dialog shows online presence for a connected member", async ({
  page,
  browser,
  request,
}) => {
  const stamp = Date.now();
  const aliceEmail = `presence-a-${stamp}@test.dev`;
  const alice = await signupUser(request, aliceEmail, "Password123!");
  const team = await createTeam(request, alice.token, `presence-team-${stamp}`);
  const channel = await createChannel(request, alice.token, team.id, `presence-${stamp}`);
  const bobEmail = `presence-b-${stamp}@test.dev`;
  const bob = await signupUser(request, bobEmail, "Password123!");
  await joinTeam(request, bob.token, team.id);
  await joinChannel(request, bob.token, channel.id);

  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await loginAs(bobPage, bobEmail, "Password123!");
  await expect(bobPage.getByPlaceholder(/Enter to send/)).toBeVisible();

  await loginAs(page, aliceEmail, "Password123!");
  await expect(page.getByPlaceholder(/Enter to send/)).toBeVisible();
  await page.getByRole("button", { name: "Members", exact: true }).click();
  await expect(page.getByRole("dialog").getByTitle("Online").first()).toBeVisible({
    timeout: 15_000,
  });

  await bobContext.close();
});

test("leaving a channel removes it from the sidebar", async ({ page, request }) => {
  const stamp = Date.now();
  const email = `leave-${stamp}@test.dev`;
  const user = await signupUser(request, email, "Password123!");
  const team = await createTeam(request, user.token, `leave-team-${stamp}`);
  const channel = await createChannel(request, user.token, team.id, `leave-${stamp}`);

  await loginAs(page, email, "Password123!");
  await expect(page.getByPlaceholder(/Enter to send/)).toBeVisible();
  await page.goto(`/${team.id}/c/${channel.id}`);
  await expect(page.getByPlaceholder(/Enter to send/)).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Channel settings" }).click();
  await page.getByRole("button", { name: "Leave channel" }).click();

  await expect(page).toHaveURL(/\/dm$/, { timeout: 15_000 });
  await expect(page.getByRole("link", { name: new RegExp(`leave-${stamp}`) })).toHaveCount(0);
});

test("browsing and joining a public channel adds it to the sidebar", async ({ page, request }) => {
  const stamp = Date.now();
  const email = `browse-${stamp}@test.dev`;
  const user = await signupUser(request, email, "Password123!");
  const team = await createTeam(request, user.token, `browse-team-${stamp}`);
  await createChannel(request, user.token, team.id, `first-${stamp}`);

  const otherEmail = `browse-other-${stamp}@test.dev`;
  const other = await signupUser(request, otherEmail, "Password123!");
  await joinTeam(request, other.token, team.id);
  const second = await createChannel(request, other.token, team.id, `second-${stamp}`);

  await loginAs(page, email, "Password123!");
  await expect(page.getByPlaceholder(/Enter to send/)).toBeVisible();
  await page.getByRole("button", { name: "Browse channels" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Join" }).first().click();

  await expect(page).toHaveURL(new RegExp(second.id), { timeout: 15_000 });
  await expect(page.getByRole("link", { name: new RegExp(`second-${stamp}`) })).toBeVisible();
});
