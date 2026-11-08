import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  net,
  Notification,
  protocol,
  safeStorage,
  session,
  Tray,
} from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import { parseOpenchatLink } from "./lib/deep-link";
import { createTokenStore } from "./lib/token-store";

// The bundled renderer is served over a privileged custom scheme (Electron's
// recommended pattern for packaged web assets): "standard" gives it a real
// origin (app://-), so history routing, storage and fetch semantics all work
// — no file:// hash-routing or Origin:null workarounds. OPENCHAT_DESKTOP_URL
// forces the remote-renderer mode (cookie auth) instead.
const APP_ORIGIN = "app://-";

// Must run before app ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const DEV_RENDERER_URL = process.env.OPENCHAT_DESKTOP_URL || "http://localhost:8787";
const PACKAGED_RENDERER_URL = process.env.OPENCHAT_DESKTOP_URL || "https://chat.openchat.dev";
// API origin for the bundled renderer (REST/WS target). Derived from the
// remote renderer URL unless overridden via OPENCHAT_API_URL.
function resolveApiUrl(): string {
  if (process.env.OPENCHAT_API_URL) {
    return process.env.OPENCHAT_API_URL;
  }
  try {
    return new URL(app.isPackaged ? PACKAGED_RENDERER_URL : DEV_RENDERER_URL).origin;
  } catch {
    return "http://localhost:8787";
  }
}

// Next to the built main.js — inside .vite/, which electron-builder already
// packages via ".vite/build/**". OPENCHAT_DESKTOP_APP_DIR overrides the
// location (tests copy the bundle to a tmp dir). Presence is NOT probed
// here: the protocol handler serves index.html as the fallback.
function bundledWebDist(): string {
  return process.env.OPENCHAT_DESKTOP_APP_DIR ?? path.join(__dirname, "web-dist");
}

/**
 * Serves the bundled web-dist over app://- with an SPA fallback and proxies
 * /api/* to the configured API origin — the renderer is same-origin with its
 * API, so no CORS handling exists anywhere. WebSockets connect to the API
 * origin directly (WS upgrades are not subject to CORS).
 */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".ico": "image/x-icon",
};

function registerAppProtocol(): void {
  const webDist = bundledWebDist();
  const apiUrl = resolveApiUrl();
  protocol.handle("app", async (request) => {
    const { pathname, search } = new URL(request.url);
    if (pathname.startsWith("/api/")) {
      // Rewrite the page origin (app://-) to the API origin: better-auth's
      // trusted-origins check would otherwise reject the request.
      const headers = new Headers(request.headers);
      headers.set("origin", apiUrl);
      headers.set("referer", `${apiUrl}/`);
      const body = ["GET", "HEAD"].includes(request.method)
        ? undefined
        : await request.arrayBuffer();
      return net.fetch(`${apiUrl}${pathname}${search}`, {
        method: request.method,
        headers,
        body,
      });
    }
    const rel = decodeURIComponent(pathname).replace(/^\/\/+/, "");
    // Unknown paths (deep routes on reload) fall back to the SPA entry;
    // traversal attempts are rejected by pure path math.
    const candidates = rel ? [rel, "index.html"] : ["index.html"];
    for (const relPath of candidates) {
      const filePath = path.join(webDist, relPath);
      const fromRoot = path.relative(webDist, filePath);
      if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) {
        continue;
      }
      const body = await fs.promises.readFile(filePath).catch(() => null);
      if (body) {
        const ext = path.extname(relPath).toLowerCase();
        return new Response(new Uint8Array(body), {
          headers: { "content-type": MIME[ext] ?? "application/octet-stream" },
        });
      }
    }
    return new Response("not found", { status: 404 });
  });
}

const tokenStore = createTokenStore(
  {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plain) => new Uint8Array(safeStorage.encryptString(plain)),
    decryptString: (payload) => safeStorage.decryptString(Buffer.from(payload)),
  },
  {
    readFile: (p) => fs.readFileSync(p),
    writeFile: (p, data) => fs.writeFileSync(p, data),
    unlink: (p) => fs.unlinkSync(p),
    exists: (p) => fs.existsSync(p),
  },
  path.join(app.getPath("userData"), "tokens.bin"),
);

let tray: Tray | null = null;
let quitting = false;
// Deep links arriving before the renderer finished loading (cold start via
// notification tap) are queued and replayed on did-finish-load — otherwise
// executeJavaScript would dispatch into a page with no listeners yet.
const pendingLinks: string[] = [];
let rendererReady = false;

function resolveRendererTarget(): { url: string } {
  if (process.env.OPENCHAT_DESKTOP_URL) {
    return { url: process.env.OPENCHAT_DESKTOP_URL };
  }
  // Bundled renderer whenever packaging guarantees web-dist, or explicitly
  // requested (tests/dev). Dev default stays the remote renderer.
  if (app.isPackaged || process.env.OPENCHAT_DESKTOP_APP === "1") {
    // The API origin rides in as a query param: the renderer reads it
    // synchronously at module init (sandboxed-preload bridge injection is
    // not guaranteed to precede page scripts on custom schemes).
    return { url: `${APP_ORIGIN}/index.html?api=${encodeURIComponent(resolveApiUrl())}` };
  }
  return { url: app.isPackaged ? PACKAGED_RENDERER_URL : DEV_RENDERER_URL };
}

function dispatchLinkToRenderer(win: BrowserWindow, link: string) {
  void win.webContents
    .executeJavaScript(
      `window.dispatchEvent(new CustomEvent("openchat:navigate", { detail: ${JSON.stringify(link)} }))`,
      true,
    )
    .catch((error: unknown) => {
      console.error("deep link dispatch failed", error);
    });
}

function navigateToLink(link: string) {
  const parsed = parseOpenchatLink(link);
  if (!parsed) {
    return;
  }
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) {
    return;
  }
  if (win.isMinimized()) {
    win.restore();
  }
  win.show();
  if (rendererReady) {
    dispatchLinkToRenderer(win, link);
  } else {
    pendingLinks.push(link);
  }
}

function showWindow() {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) {
    return;
  }
  if (win.isMinimized()) {
    win.restore();
  }
  win.show();
  win.focus();
}

/**
 * Tray/icon assets resolve against several bases because electron-builder
 * packs the main bundle as `.vite/build/main.js` while `assets/**` lands at
 * the asar root (electron-builder.yml files layout):
 *   - packaged: <app.asar>/assets  → app.getAppPath() + "assets"
 *               (`__dirname/../assets` points into app.asar/.vite/assets,
 *               which does not exist — review #15)
 *   - dev:      apps/desktop/assets → also app.getAppPath() + "assets"
 *               (app path is the project dir pre-package)
 *   - test overrides via OPENCHAT_DESKTOP_APP_DIR keep working through the
 *     same base.
 * Returns null when nothing exists → caller degrades gracefully (no tray).
 */
function resolveAssetDir(): string | null {
  const candidates = [
    path.join(app.getAppPath(), "assets"),
    process.env.OPENCHAT_DESKTOP_APP_DIR
      ? path.join(process.env.OPENCHAT_DESKTOP_APP_DIR, "assets")
      : null,
    path.join(__dirname, "../../assets"),
    path.join(__dirname, "../assets"), // legacy layout fallback
  ].filter((p): p is string => typeof p === "string");
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "tray.png")) || fs.existsSync(path.join(dir, "icon.png"))) {
      return dir;
    }
  }
  return null;
}

function createTray() {
  const assetDir = resolveAssetDir();
  if (!assetDir) {
    console.warn("tray assets not found; starting without a tray");
    return;
  }
  const iconPath = path.join(assetDir, "tray.png");
  const trayIcon = fs.existsSync(iconPath) ? iconPath : path.join(assetDir, "icon.png");
  tray = new Tray(trayIcon);
  (globalThis as Record<string, unknown>).__openchatTrayAvailable = true;
  tray.setToolTip("openchat");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "打开 openchat",
        click: () => showWindow(),
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () => showWindow());
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // API origin for the bundled renderer (sandboxed preloads keep their
      // argv, including these injected switches).
      additionalArguments: [`--openchat-api=${resolveApiUrl()}`],
    },
  });

  // Close-to-tray: the renderer (and its WebSocket) keeps running hidden so
  // returning to the app is instant (spec §4.1 / completion criterion 4).
  win.on("close", (event) => {
    if (!quitting && tray) {
      event.preventDefault();
      win.hide();
    }
  });

  win.webContents.on("did-finish-load", () => {
    rendererReady = true;
    while (pendingLinks.length > 0) {
      const link = pendingLinks.shift();
      if (link) {
        dispatchLinkToRenderer(win, link);
      }
    }
  });

  const target = resolveRendererTarget();
  void win.loadURL(target.url);
  return win;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const link = argv.find((arg) => arg.startsWith("openchat://"));
    if (link) {
      navigateToLink(link);
    }
    showWindow();
  });

  void app.whenReady().then(() => {
    // Serve the bundled renderer over the privileged app:// scheme.
    registerAppProtocol();

    createWindow();
    try {
      createTray();
    } catch (error) {
      // Linux without libappindicator: tray unavailable; degrade to a plain
      // windowed app (close actually quits).
      console.error("tray unavailable", error);
    }

    app.setAsDefaultProtocolClient("openchat");

    ipcMain.on("notify", (_event, payload: { title: string; body: string; link?: string }) => {
      if (!Notification.isSupported()) {
        return;
      }
      const notification = new Notification({ title: payload.title, body: payload.body });
      notification.on("click", () => {
        showWindow();
        if (payload.link) {
          navigateToLink(payload.link);
        }
      });
      notification.show();
    });

    ipcMain.handle("token:get", () => tokenStore.getToken());
    ipcMain.handle("token:set", (_event, token: string) => tokenStore.setToken(token));
    ipcMain.handle("token:clear", () => tokenStore.clearToken());
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    navigateToLink(url);
  });

  app.on("before-quit", () => {
    quitting = true;
    (globalThis as Record<string, unknown>).__openchatQuitting = true;
  });

  app.on("window-all-closed", () => {
    // Tray-resident shell: keep running on all platforms until Quit.
    if (!tray) {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showWindow();
    }
  });
}

// autoUpdater is wired for packaged builds only; the feed URL comes from the
// environment (spec §6.2: R2 / GitHub Releases hosting).
if (app.isPackaged && process.env.OPENCHAT_DESKTOP_UPDATE_URL) {
  void import("electron-updater").then(({ autoUpdater }) => {
    autoUpdater.autoDownload = true;
    try {
      autoUpdater.setFeedURL({
        provider: "generic",
        url: process.env.OPENCHAT_DESKTOP_UPDATE_URL as string,
      });
      void autoUpdater.checkForUpdatesAndNotify();
      setInterval(() => void autoUpdater.checkForUpdatesAndNotify(), 4 * 60 * 60 * 1000);
    } catch (error) {
      console.error("auto-update setup failed", error);
    }
  });
}
