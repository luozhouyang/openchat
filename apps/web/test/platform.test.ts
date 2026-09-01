// @vitest-environment jsdom
// Platform implementations live in the app (P12 D11); these tests pin the
// browser and desktop-file adapters against the shared contract.
import { expect, test, vi } from "vite-plus/test";
import { deriveWsUrl, type DesktopBridge } from "platform";
import { createWebPlatform, LocalStorageAdapter } from "../src/platform/web";
import { createDesktopFilePlatform } from "../src/platform/desktop-file";

function mockBridge(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    notify: vi.fn(),
    getToken: vi.fn(async () => "session-token"),
    setToken: vi.fn(async () => {}),
    clearToken: vi.fn(async () => {}),
    serverUrl: "http://localhost:8787",
    ...overrides,
  };
}

test("deriveWsUrl switches scheme and appends the ws path", () => {
  expect(deriveWsUrl("http://localhost:8787")).toBe("ws://localhost:8787/ws");
  expect(deriveWsUrl("https://chat.example.com")).toBe("wss://chat.example.com/ws");
});

test("web platform derives urls from location and runs cookie mode", () => {
  Object.defineProperty(window, "location", {
    value: { protocol: "https:", host: "example.com", origin: "https://example.com" },
    configurable: true,
  });
  const p = createWebPlatform();
  expect(p.platform).toBe("web");
  expect(p.apiBaseUrl).toBe("https://example.com");
  expect(p.wsUrl).toBe("wss://example.com/ws");
  expect(p.getSessionToken()).resolves.toBeNull();
  expect(p.desktopBridge).toBeUndefined();
});

test("web platform honors apiBaseUrl override", () => {
  const p = createWebPlatform({ apiBaseUrl: "http://localhost:8787" });
  expect(p.wsUrl).toBe("ws://localhost:8787/ws");
});

test("desktop-file platform routes auth through the bridge", async () => {
  const bridge = mockBridge();
  const p = createDesktopFilePlatform({ serverUrl: bridge.serverUrl, bridge });
  expect(p.platform).toBe("desktop");
  expect(p.apiBaseUrl).toBe("http://localhost:8787");
  expect(p.wsUrl).toBe("ws://localhost:8787/ws");
  expect(await p.getSessionToken()).toBe("session-token");
  expect(p.desktopBridge).toBe(bridge);
});

test("web openLocalDatabase degrades to memory without workers (jsdom)", async () => {
  const p = createWebPlatform();
  const db = await p.openLocalDatabase();
  await db.migrate();
  await db.messages.append("c1", {
    id: "m1",
    seq: 1,
    userId: "u1",
    parentId: null,
    type: "text",
    content: "hi",
    createdAt: 1,
    attachments: null,
    mentions: null,
    editedAt: null,
    deletedAt: null,
  });
  expect(await db.messages.maxSeq("c1")).toBe(1);
  // memoized: same instance on the second call
  expect(await p.openLocalDatabase()).toBe(db);
});

test("LocalStorageAdapter delegates to window.localStorage", () => {
  const a = new LocalStorageAdapter();
  a.set("k", "v");
  expect(a.get("k")).toBe("v");
  expect(window.localStorage.getItem("k")).toBe("v");
  a.remove("k");
  expect(a.get("k")).toBeNull();
});
