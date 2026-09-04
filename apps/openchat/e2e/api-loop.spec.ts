import { expect, test } from "@playwright/test";
import { createChannel, createTeam, loginAs, signupUser } from "./fixtures";

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
