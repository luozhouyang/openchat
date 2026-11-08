import { expect, test } from "@playwright/test";
import { createTeam, joinChannel, joinTeam, loginAs, signupUser } from "./fixtures";

test("second user receives a channel message live over websocket", async ({
  page,
  browser,
  request,
}) => {
  const emailA = `livea-${Date.now()}@test.dev`;
  const emailB = `liveb-${Date.now()}@test.dev`;
  const password = "test-password";

  const a = await signupUser(request, emailA, password);
  const b = await signupUser(request, emailB, password);
  const team = await createTeam(request, a.token, `liveteam${Date.now()}`);
  await joinTeam(request, b.token, team.id);

  // B gets an isolated browser context (separate session cookies).
  const ctxB = await browser.newContext();
  try {
    const pageB = await ctxB.newPage();
    await loginAs(page, emailA, password);
    await loginAs(pageB, emailB, password);

    // A creates the channel from the sidebar '+'
    await page.getByRole("button", { name: "New channel" }).click();
    await page.getByLabel("Channel name").fill("Live Channel");
    await page.getByRole("button", { name: "Create channel" }).click();
    await expect(page).toHaveURL(/\/c\//);
    const channelId = new URL(page.url()).pathname.split("/").pop()!;

    // B joins the channel (public) via API, reloads, then opens it
    await joinChannel(request, b.token, channelId);
    await pageB.reload();
    await pageB.getByRole("link", { name: "Live Channel" }).click();
    await expect(pageB.getByPlaceholder(/Enter to send/)).toBeVisible();

    // A sends a message
    await page.getByPlaceholder(/Enter to send/).fill("live hello");
    await page.getByPlaceholder(/Enter to send/).press("Enter");

    // B sees it with no reload / no navigation — the only delivery path is
    // the websocket push from the channel DO to B's open socket.
    await expect(pageB.getByText("live hello")).toBeVisible();
  } finally {
    await ctxB.close();
  }
});
