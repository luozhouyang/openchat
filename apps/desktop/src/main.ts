import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  safeStorage,
  session,
  Tray,
} from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import { parseOpenchatLink } from "./lib/deep-link";
import { createTokenStore } from "./lib/token-store";

// This shell loads the web renderer over http(s) (cookie auth works) or the
// packaged local build from file:// (bearer auth via the preload bridge),
// per p10 spec §6.2. OPENCHAT_DESKTOP_FILE overrides for testing; production
// prefers the bundled web-dist when present.
const DEV_RENDERER_URL = process.env.OPENCHAT_DESKTOP_URL ?? "http://localhost:8787";
const PACKAGED_RENDERER_URL = process.env.OPENCHAT_DESKTOP_URL ?? "https://chat.openchat.dev";
// API origin for the file:// renderer (REST/WS target). Derived from the
// remote renderer URL unless overridden via OPENCHAT_API_URL.
function resolveApiUrl(): string {
  if (process.env.OPENCHAT_API_URL) return process.env.OPENCHAT_API_URL;
  try {
    return new URL(app.isPackaged ? PACKAGED_RENDERER_URL : DEV_RENDERER_URL).origin;
  } catch {
    return "http://localhost:8787";
  }
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

function resolveRendererTarget(): { url?: string; file?: string } {
  const fileOverride = process.env.OPENCHAT_DESKTOP_FILE;
  if (fileOverride) return { file: fileOverride };
  if (app.isPackaged) {
    const bundled = path.join(__dirname, "../web-dist/index.html");
    if (fs.existsSync(bundled)) return { file: bundled };
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
  if (!parsed) return;
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  if (rendererReady) {
    dispatchLinkToRenderer(win, link);
  } else {
    pendingLinks.push(link);
  }
}

function showWindow() {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  const iconPath = path.join(__dirname, "../assets/tray.png");
  const trayIcon = fs.existsSync(iconPath) ? iconPath : path.join(__dirname, "../assets/icon.png");
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
      // API origin for the file:// renderer (sandboxed preloads keep their
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
      if (link) dispatchLinkToRenderer(win, link);
    }
  });

  const target = resolveRendererTarget();
  if (target.url) void win.loadURL(target.url);
  else if (target.file) void win.loadFile(target.file);
  return win;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const link = argv.find((arg) => arg.startsWith("openchat://"));
    if (link) navigateToLink(link);
    showWindow();
  });

  void app.whenReady().then(() => {
    // file:// renderer → API calls are cross-origin with the literal origin
    // "null". Rewrite the request Origin to the API origin (better-auth
    // trusted-origins checks it) and answer with matching CORS headers, so
    // the bearer-based web renderer works without opening CORS to null on
    // the server side.
    const apiUrl = resolveApiUrl();
    const filter = { urls: [`${apiUrl}/*`] };
    session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
      // Header names arrive lower-cased from the network stack.
      const originKey = Object.keys(details.requestHeaders).find(
        (k) => k.toLowerCase() === "origin",
      );
      if (originKey && details.requestHeaders[originKey] === "null") {
        details.requestHeaders[originKey] = apiUrl;
      }
      const refererKey = Object.keys(details.requestHeaders).find(
        (k) => k.toLowerCase() === "referer",
      );
      if (refererKey) details.requestHeaders[refererKey] = `${apiUrl}/`;
      else details.requestHeaders["Referer"] = `${apiUrl}/`;
      callback({ requestHeaders: details.requestHeaders });
    });
    session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
      const headers = details.responseHeaders ?? {};
      if (headers["access-control-allow-origin"] === undefined) {
        headers["access-control-allow-origin"] = ["*"];
        headers["access-control-allow-headers"] = ["authorization, content-type"];
        headers["access-control-allow-methods"] = ["GET, POST, PUT, DELETE, OPTIONS"];
      }
      callback({ responseHeaders: headers });
    });

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
      if (!Notification.isSupported()) return;
      const notification = new Notification({ title: payload.title, body: payload.body });
      notification.on("click", () => {
        showWindow();
        if (payload.link) navigateToLink(payload.link);
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
    if (!tray) app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
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
