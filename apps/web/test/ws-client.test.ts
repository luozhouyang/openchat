import { expect, test } from "vite-plus/test";
import { useConnectionStore } from "../src/stores/connection";
import { useSidebarStore } from "../src/stores/sidebar";

test("connection store transitions", () => {
  useConnectionStore.getState().set("open");
  expect(useConnectionStore.getState().state).toBe("open");
});

test("sidebar bump and markRead", () => {
  const s = useSidebarStore.getState();
  s.bump("c1");
  s.bump("c1");
  expect(useSidebarStore.getState().entries["c1"].unread).toBe(2);
  s.markRead("c1");
  expect(useSidebarStore.getState().entries["c1"].unread).toBe(0);
});
