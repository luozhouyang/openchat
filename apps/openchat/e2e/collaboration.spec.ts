import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  API,
  createChannel,
  createTeam,
  joinChannel,
  joinTeam,
  loginAs,
  signupUser,
  userIdOf,
} from "./fixtures";

let seq = Date.now();

async function postAs(
  request: APIRequestContext,
  token: string,
  channelId: string,
  message: string,
): Promise<void> {
  const res = await request.post(`${API}/api/v1/channels/${channelId}/posts`, {
    headers: { authorization: `Bearer ${token}`, origin: API },
    data: { message },
  });
  expect(res.ok(), `post failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

test("a mention lands in the notification bell", async ({ page, request }) => {
  const stamp = seq++;
  const aliceEmail = `notif-a-${stamp}@test.dev`;
  const alice = await signupUser(request, aliceEmail, "Password123!");
  const team = await createTeam(request, alice.token, `notif-team-${stamp}`);
  const channel = await createChannel(request, alice.token, team.id, `notif-${stamp}`);
  const bobEmail = `notif-b-${stamp}@test.dev`;
  const bob = await signupUser(request, bobEmail, "Password123!");
  await joinTeam(request, bob.token, team.id);
  await joinChannel(request, bob.token, channel.id);
  const aliceId = await userIdOf(request, alice.token);

  await loginAs(page, aliceEmail, "Password123!");
  await expect(page.getByPlaceholder(/Enter to send/)).toBeVisible();

  await postAs(request, bob.token, channel.id, `hey @[${aliceId}] ping`);

  const bell = page.getByRole("button", { name: "Notifications" });
  await expect(bell).toContainText("1", { timeout: 15_000 });
  await bell.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Mention", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/hey @/)).toBeVisible();
});

test("global search finds hits in other channels", async ({ page, request }) => {
  const stamp = seq++;
  const email = `search-${stamp}@test.dev`;
  const user = await signupUser(request, email, "Password123!");
  const team = await createTeam(request, user.token, `search-team-${stamp}`);
  await createChannel(request, user.token, team.id, `first-${stamp}`);
  const second = await createChannel(request, user.token, team.id, `second-${stamp}`);
  await postAs(request, user.token, second.id, "zebra deployment ready");

  await loginAs(page, email, "Password123!");
  await expect(page.getByPlaceholder(/Enter to send/)).toBeVisible();

  await page.getByRole("button", { name: "Search messages" }).click();
  await page.getByRole("button", { name: "All channels" }).click();
  await page.getByPlaceholder("Search this channel").fill("zebra");
  await expect(page.getByText("zebra deployment ready")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(`#second-${stamp}`)).toBeVisible();
});
