import { expect, test, vi } from "vite-plus/test";
import { createWebPlatform } from "../src/web.ts";
import { LocalStorageAdapter } from "../src/storage.ts";

test("serverUrl derives wss from https location", () => {
  Object.defineProperty(window, "location", {
    value: { protocol: "https:", host: "example.com" },
    configurable: true,
  });
  const p = createWebPlatform({ getAuthToken: vi.fn(async () => null) });
  expect(p.platform).toBe("web");
  expect(p.serverUrl).toBe("wss://example.com/ws");
});

test("serverUrl uses ws for http and honors override", () => {
  Object.defineProperty(window, "location", {
    value: { protocol: "http:", host: "localhost:5173" },
    configurable: true,
  });
  const p = createWebPlatform({ getAuthToken: vi.fn(async () => null) });
  expect(p.serverUrl).toBe("ws://localhost:5173/ws");
  const p2 = createWebPlatform({
    getAuthToken: vi.fn(async () => null),
    serverUrl: "wss://api.example.com/ws",
  });
  expect(p2.serverUrl).toBe("wss://api.example.com/ws");
});

test("onAppStateChange maps hidden->background, visible->active and unsubscribes", () => {
  const p = createWebPlatform({ getAuthToken: vi.fn(async () => null) });
  const cb = vi.fn();
  const unsub = p.onAppStateChange(cb);
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  expect(cb).toHaveBeenLastCalledWith("background");
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  expect(cb).toHaveBeenLastCalledWith("active");
  unsub();
  document.dispatchEvent(new Event("visibilitychange"));
  expect(cb).toHaveBeenCalledTimes(2);
});

test("storage adapter delegates to localStorage", () => {
  localStorage.clear();
  const p = createWebPlatform({ getAuthToken: vi.fn(async () => null) });
  p.storage.set("k", "v");
  expect(localStorage.getItem("k")).toBe("v");
  expect(p.storage.get("k")).toBe("v");
  p.storage.remove("k");
  expect(p.storage.get("k")).toBeNull();
});

test("LocalStorageAdapter round-trips values", () => {
  localStorage.clear();
  const s = new LocalStorageAdapter();
  s.set("a", "1");
  expect(s.get("a")).toBe("1");
  s.remove("a");
  expect(s.get("a")).toBeNull();
});

test("getAuthToken is forwarded from options", async () => {
  const getAuthToken = vi.fn(async () => "tok");
  const p = createWebPlatform({ getAuthToken });
  expect(await p.getAuthToken()).toBe("tok");
});
