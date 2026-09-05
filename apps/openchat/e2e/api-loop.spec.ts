import { expect, test } from "@playwright/test";
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

function countByPattern(calls: string[], pattern: string): number {
  return calls.filter((u) => u.includes(pattern)).length;
}

function instrument(page: import("@playwright/test").Page): string[] {
  const calls: string[] = [];
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("/api/v1/users/me/workspaces") || u.includes("/api/v1/users/me/sidebar")) {
      calls.push(u.replace("http://localhost:4173", ""));
    }
  });
  return calls;
}

test("idle page does not hammer workspaces/sidebar (no echo loop)", async ({ page, request }) => {
  page.on("pageerror", (err) => console.log("[pageerror]", err));

  const email = `loop-idle-${seq}@test.dev`;
  const user = await signupUser(request, email, "Password123!");
  const team = await createTeam(request, user.token, `loop-idle-team-${seq}`);
  await createChannel(request, user.token, team.id, `loop-idle-ch-${seq}`);
  seq += 1;

  await loginAs(page, email, "Password123!");
  await expect(page).toHaveURL(new RegExp(`/${team.id}/c/`), { timeout: 15_000 });

  // Drain navigation-triggered fetches, then dwell idle. Before the fix this
  // window saw ~240 workspaces + ~240 sidebar calls (~40 req/s echo loop).
  await page.waitForTimeout(2_000);
  const calls = instrument(page);
  await page.waitForTimeout(6_000);

  const ws = countByPattern(calls, "workspaces");
  const sb = countByPattern(calls, "sidebar");
  expect(ws, `workspaces calls during 6s idle dwell: ${ws}`).toBeLessThanOrEqual(2);
  expect(sb, `sidebar calls during 6s idle dwell: ${sb}`).toBeLessThanOrEqual(2);
});

test("settings back button returns to the channel view", async ({ page, request }) => {
  page.on("pageerror", (err) => console.log("[pageerror]", err));

  const email = `nav-ret-${seq}@test.dev`;
  const user = await signupUser(request, email, "Password123!");
  const team = await createTeam(request, user.token, `nav-ret-team-${seq}`);
  await createChannel(request, user.token, team.id, `nav-ret-ch-${seq}`);
  seq += 1;

  await loginAs(page, email, "Password123!");
  await expect(page).toHaveURL(new RegExp(`/${team.id}/c/`), { timeout: 15_000 });

  await page
    .getByRole("button", { name: /nav-ret-team/ })
    .first()
    .click();
  await page.getByText("Team settings").click();
  await expect(page).toHaveURL(new RegExp(`/${team.id}/settings`), { timeout: 10_000 });

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${team.id}/c/`), { timeout: 10_000 });

  // Save flow: back must work after saving too (this previously landed on a
  // broken/blank navigation because the loop kept invalidating mid-flight).
  await page
    .getByRole("button", { name: /nav-ret-team/ })
    .first()
    .click();
  await page.getByText("Team settings").click();
  await expect(page).toHaveURL(new RegExp(`/${team.id}/settings`), { timeout: 10_000 });
  await page.getByLabel("Team name").fill("Renamed");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${team.id}/c/`), { timeout: 10_000 });
});

test("a new direct message appears in the other user's sidebar without refresh", async ({
  browser,
  request,
}) => {
  const emailA = `rt-a-${seq}@test.dev`;
  const emailB = `rt-b-${seq}@test.dev`;
  const userA = await signupUser(request, emailA, "Password123!");
  const userB = await signupUser(request, emailB, "Password123!");
  const idA = await userIdOf(request, userA.token);
  const idB = await userIdOf(request, userB.token);
  seq += 1;

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  const wsReady = pageB.waitForEvent("websocket").then((ws) => ws.waitForEvent("framereceived"));
  await loginAs(pageB, emailB, "Password123!");
  await expect(pageB).toHaveURL(/\/dm/, { timeout: 15_000 });
  await wsReady;

  const res = await request.post(`${API}/api/v1/channels/direct`, {
    headers: { authorization: `Bearer ${userA.token}`, origin: API },
    data: { userIds: [idA, idB] },
  });
  expect(res.ok()).toBeTruthy();
  await expect(pageB.getByText(`rt-a-${seq - 1}`)).toBeVisible({ timeout: 10_000 });

  await pageB.close();
  await ctxB.close();
});

test("team rename propagates to other online members without refresh", async ({
  browser,
  request,
}) => {
  const emailA = `rn-a-${seq}@test.dev`;
  const emailB = `rn-b-${seq}@test.dev`;
  const userA = await signupUser(request, emailA, "Password123!");
  const userB = await signupUser(request, emailB, "Password123!");
  const team = await createTeam(request, userA.token, `rn-team-${seq}`);
  const channel = await createChannel(request, userA.token, team.id, `rn-ch-${seq}`);
  await joinTeam(request, userB.token, team.id);
  await joinChannel(request, userB.token, channel.id);
  seq += 1;

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  const wsReady = pageB.waitForEvent("websocket").then((ws) => ws.waitForEvent("framereceived"));
  await loginAs(pageB, emailB, "Password123!");
  await expect(pageB).toHaveURL(new RegExp(`/${team.id}/c/`), { timeout: 15_000 });
  await wsReady;

  const res = await request.put(`${API}/api/v1/teams/${team.id}/patch`, {
    headers: { authorization: `Bearer ${userA.token}`, origin: API },
    data: { displayName: `renamed-${seq}` },
  });
  expect(res.ok()).toBeTruthy();
  await expect(
    pageB.getByRole("button", { name: new RegExp(`renamed-${seq}`) }).first(),
  ).toBeVisible({ timeout: 10_000 });

  await pageB.close();
  await ctxB.close();
});
