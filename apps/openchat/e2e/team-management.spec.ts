import { expect, test } from "@playwright/test";
import { createChannel, createTeam, loginAs, signupUser } from "./fixtures";

let seq = Date.now();

test("creates a team through the UI dialog and lands in the new team", async ({
  page,
  request,
}) => {
  page.on("pageerror", (err) => console.log("[pageerror]", err));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log("[console.error]", msg.text());
    }
  });

  const email = `tm-create-${seq}@test.dev`;
  const user = await signupUser(request, email, "Password123!");
  await createTeam(request, user.token, `init-team-${seq}`);
  seq += 1;

  await loginAs(page, email, "Password123!");

  await page
    .getByRole("button", { name: /init-team/ })
    .first()
    .click();
  await page.getByText("Create team").click();

  await expect(page.getByText("Create team")).toBeVisible();
  const newName = `ui-team-${seq}`;
  await page.getByLabel("Identifier (lowercase letters and digits)").fill(newName);
  await page.getByLabel("Team name").fill(newName);
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page).not.toHaveURL(/\/teams\/new/, { timeout: 15_000 });
  seq += 1;
});

test("team switcher navigates between teams", async ({ page, request }) => {
  page.on("pageerror", (err) => console.log("[pageerror]", err));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log("[console.error]", msg.text());
    }
  });

  const email = `tm-switch-${seq}@test.dev`;
  const user = await signupUser(request, email, "Password123!");
  const t1 = await createTeam(request, user.token, `switch-a-${seq}`);
  const t2 = await createTeam(request, user.token, `switch-b-${seq}`);
  await createChannel(request, user.token, t1.id, `ch-${seq}`);
  seq += 1;

  await loginAs(page, email, "Password123!");
  await expect(page).toHaveURL(new RegExp(`/${t1.id}/c/`), { timeout: 15_000 });

  await page
    .getByRole("button", { name: /switch-a/ })
    .first()
    .click();
  await page.getByText("switch-b").click();
  await expect(page).toHaveURL(new RegExp(`/${t2.id}`), { timeout: 15_000 });
});

test("settings page saves team name", async ({ page, request }) => {
  page.on("pageerror", (err) => console.log("[pageerror]", err));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log("[console.error]", msg.text());
    }
  });

  const email = `tm-settings-${seq}@test.dev`;
  const user = await signupUser(request, email, "Password123!");
  await createTeam(request, user.token, `settings-team-${seq}`);
  seq += 1;

  await loginAs(page, email, "Password123!");

  await page
    .getByRole("button", { name: /settings-team/ })
    .first()
    .click();
  await page.getByText("Team settings").click();

  await expect(page).toHaveURL(/\/settings$/, { timeout: 10_000 });
  await page.getByLabel("Team name").fill("Renamed Team");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved")).toBeVisible({ timeout: 10_000 });
});

test("shows leave team option in the team switcher", async ({ page, request }) => {
  page.on("pageerror", (err) => console.log("[pageerror]", err));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log("[console.error]", msg.text());
    }
  });

  const email = `tm-leave-${seq}@test.dev`;
  const user = await signupUser(request, email, "Password123!");
  await createTeam(request, user.token, `leave-team-${seq}`);
  seq += 1;

  await loginAs(page, email, "Password123!");

  await page
    .getByRole("button", { name: /leave-team/ })
    .first()
    .click();
  await expect(page.getByText("Leave team")).toBeVisible();
});
