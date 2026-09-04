// @vitest-environment jsdom
// The "platform instance" case imports lib/platform, which reads
// window.location at module init; jsdom keeps that working under the root
// aggregate runner too (the web package config already sets jsdom).
import { expect, test } from "vite-plus/test";
import { useConnectionStore } from "@/stores/connection";
import { useSidebarStore } from "@/stores/sidebar";

test("connection store transitions", () => {
  useConnectionStore.getState().set("open");
  expect(useConnectionStore.getState().state).toBe("open");
});

test("platform instance resolves urls and the adapter surface", async () => {
  const { platform } = await import("@/lib/platform");
  expect(platform.platform).toBe("web");
  expect(platform.wsUrl).toMatch(/^wss?:\/\/.*\/ws$/);
  expect(typeof platform.openLocalDatabase).toBe("function");
});

test("sidebar bump and markRead", () => {
  const s = useSidebarStore.getState();
  s.bump("c1");
  s.bump("c1");
  expect(useSidebarStore.getState().entries["c1"].unread).toBe(2);
  s.markRead("c1");
  expect(useSidebarStore.getState().entries["c1"].unread).toBe(0);
});
