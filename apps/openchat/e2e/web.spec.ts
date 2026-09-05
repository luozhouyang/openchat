import { expect, test } from "@playwright/test";
import { createChannel, createTeam, loginAs, signupUser } from "./fixtures";

let seq = Date.now();

test("user signs up, logs in, and lands in a channel view", async ({ page, request }) => {
  page.on("pageerror", (err) => console.log("[pageerror]", err));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log("[console.error]", msg.text());
    }
  });

  const email = `u-${seq}@test.dev`;
  const user = await signupUser(request, email, "Password123!");
  const team = await createTeam(request, user.token, `e2e-team-${seq}`);
  const channel = await createChannel(request, user.token, team.id, `general-${seq}`);
  seq += 1;

  await loginAs(page, email, "Password123!");

  // Authenticated workspace route resolves to the first channel of the first team.
  await expect(page).toHaveURL(new RegExp(`/${team.id}/c/${channel.id}`), { timeout: 15_000 });
  await expect(page.getByPlaceholder("输入消息…")).toBeVisible();

  // Send a message and see it rendered (optimistic or via ack).
  const composer = page.getByPlaceholder("输入消息…");
  await composer.fill("hello from e2e");
  await composer.press("Enter");
  await expect(page.getByText("hello from e2e").first()).toBeVisible();

  // Round-trip proof: after a reload the message comes back from server history,
  // which is only possible if the WS send actually reached the API.
  await page.reload();
  await expect(page.getByText("hello from e2e").first()).toBeVisible({ timeout: 15_000 });
});
