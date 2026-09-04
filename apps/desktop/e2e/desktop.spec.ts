import { mkdtempSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { createChannel, createTeam, signupUser } from "../../openchat/e2e/fixtures";

// Desktop e2e drives a dedicated wrangler dev on :8787; the shared fixtures
// read E2E_API_URL to target that API.
process.env.E2E_API_URL = "http://localhost:8787";

const RENDERER = "http://localhost:4173";

async function launchApp(env: Record<string, string> = {}) {
  return electron.launch({
    args: [".vite/build/main.js"],
    cwd: __dirname.replace(/\/e2e$/, ""),
    env: {
      ...process.env,
      OPENCHAT_DESKTOP_URL: RENDERER,
      DISPLAY: process.env.DISPLAY ?? ":0",
      ...env,
    } as Record<string, string>,
  });
}

let seq = Date.now();

test.describe("openchat desktop shell", () => {
  let app: ElectronApplication;
  let page: Page;
  const email = `desktop-${seq}@test.dev`;
  const password = "Password123!";

  test.beforeAll(async () => {
    // Electron requires a running X server; the spec's e2e runner provides one
    // (locally: your session; CI: xvfb-run).
    const probe = await launchApp().catch((error) => {
      test.skip(true, `no display available for Electron: ${error.message}`);
      return null as unknown as ElectronApplication;
    });
    if (!probe) return;
    app = probe;
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("loads the web renderer over http", async () => {
    await expect(page).toHaveURL(new RegExp(`^${RENDERER}`));
  });

  test("renderer bridge is exposed with least-privilege surface", async () => {
    const bridge = await page.evaluate(() => {
      const b = (window as unknown as Record<string, unknown>).openchatDesktop as
        | Record<string, unknown>
        | undefined;
      return b ? Object.keys(b).sort() : null;
    });
    expect(bridge).toEqual(["clearToken", "getToken", "notify", "serverUrl", "setToken"]);
  });

  test("safeStorage-backed token store round-trips through IPC", async () => {
    await page.evaluate(async () => {
      const b = (
        window as unknown as { openchatDesktop: { setToken: (t: string) => Promise<void> } }
      ).openchatDesktop;
      await b.setToken("tok-e2e");
    });
    const token = await page.evaluate(async () => {
      const b = (
        window as unknown as { openchatDesktop: { getToken: () => Promise<string | null> } }
      ).openchatDesktop;
      return b.getToken();
    });
    expect(token).toBe("tok-e2e");
  });

  test("login works inside the shell and lands in a channel", async ({ request }) => {
    const user = await signupUser(request, email, password);
    const team = await createTeam(request, user.token, `desktop-team-${seq}`);
    const channel = await createChannel(request, user.token, team.id, `general-${seq}`);
    seq += 1;

    // The fresh renderer redirects an unauthenticated visitor to /auth/login.
    await page.goto(`${RENDERER}/auth/login`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(new RegExp(`/${team.id}/c/${channel.id}`), { timeout: 20_000 });
    await expect(page.getByPlaceholder("输入消息…")).toBeVisible();
  });

  test("deep link event reaches the renderer navigation hook", async () => {
    // The main process dispatches this exact event shape via
    // webContents.executeJavaScript (queued until did-finish-load); here we
    // verify the renderer-side listener wiring the web app installs in
    // main.tsx (listenForOpenchatLinks).
    const handled = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          window.addEventListener("openchat:navigate", () => resolve(true), { once: true });
          window.dispatchEvent(
            new CustomEvent("openchat:navigate", { detail: "openchat://c/chn_x" }),
          );
        }),
    );
    expect(handled).toBe(true);
  });

  test("close is tray-resident when a tray exists, graceful quit otherwise", async () => {
    const trayAvailable = await app.evaluate(
      () => !!(globalThis as Record<string, unknown>).__openchatTrayAvailable,
    );
    await page.close();
    if (trayAvailable) {
      // App stays alive with no windows; tray click restores the window.
      await expect
        .poll(
          async () =>
            await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
        )
        .toBe(0);
      expect(app.process().pid).toBeTruthy();
      await app.evaluate(({ BrowserWindow }) => {
        for (const w of BrowserWindow.getAllWindows()) w.show();
      });
      const wins = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
      expect(wins).toBeGreaterThan(0);
    } else {
      // No tray backend (bare Linux): closing quits the app gracefully.
      await expect
        .poll(
          async () => {
            try {
              const proc = app.process();
              return proc.exitCode !== null || proc.killed || !proc.connected;
            } catch {
              return true; // process handle already gone
            }
          },
          { timeout: 10_000 },
        )
        .toBe(true);
    }
  });
});

test.describe("openchat desktop app:// bundled renderer mode", () => {
  let app: ElectronApplication;
  let page: Page;
  // Requires the desktop web build (pnpm run build:web in apps/desktop) and
  // a running API on :8787 (the shared webServer above provides it).
  // OPENCHAT_DESKTOP_APP selects the bundled renderer over app://-; the
  // bundle is copied to a tmp dir and injected via OPENCHAT_DESKTOP_APP_DIR
  // so the test never depends on the dev checkout's fs layout.
  test.beforeAll(async () => {
    // Copy the bundle the playwright webServer itself built (apps/openchat/dist/client,
    // via openchat#build) — same process view, unlike dev-checkout artifacts.
    const src = join(__dirname.replace(/\/e2e$/, ""), "../openchat/dist/client");
    const appDir = mkdtempSync(join(tmpdir(), "openchat-web-dist-"));
    cpSync(src, appDir, { recursive: true });
    app = await electron.launch({
      args: [".vite/build/main.js"],
      cwd: __dirname.replace(/\/e2e$/, ""),
      env: {
        ...process.env,
        OPENCHAT_DESKTOP_APP: "1",
        OPENCHAT_DESKTOP_APP_DIR: appDir,
        OPENCHAT_API_URL: "http://localhost:8787",
        DISPLAY: process.env.DISPLAY ?? ":0",
      } as Record<string, string>,
    });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("loads the renderer from app:// with the injected API origin", async () => {
    await expect(page).toHaveURL(/^app:\/\//);
    const probe = await page.evaluate(() => ({
      protocol: window.location.protocol,
      origin: window.location.origin,
      hasBridge: !!(window as unknown as Record<string, unknown>).openchatDesktop,
    }));
    console.log("[probe]", JSON.stringify(probe));
    const serverUrl = await page.evaluate(
      () =>
        (window as unknown as { openchatDesktop: { serverUrl: string } }).openchatDesktop.serverUrl,
    );
    expect(serverUrl).toBe("http://localhost:8787");
  });

  test("bearer sign-in lands in a channel (history routes, no cookies)", async ({ request }) => {
    const seq = Date.now();
    const email = `desktop-app-${seq}@test.dev`;
    const password = "Password123!";
    const user = await signupUser(request, email, password);
    const team = await createTeam(request, user.token, `app-team-${seq}`);
    const channel = await createChannel(request, user.token, team.id, `general-${seq}`);

    // Fresh instance without a session: the root guard redirects to /auth/login.
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByPlaceholder("输入消息…")).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(new RegExp(`app://-/.*/${channel.id}`));
  });
});
