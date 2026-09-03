import { expect, test } from "vite-plus/test";
import { deriveWsUrl } from "../src/types.ts";

test("deriveWsUrl converts http origins to same-scheme ws endpoints", () => {
  expect(deriveWsUrl("https://chat.openchat.dev")).toBe("wss://chat.openchat.dev/ws");
  expect(deriveWsUrl("http://localhost:8787")).toBe("ws://localhost:8787/ws");
});

test("deriveWsUrl passes through trailing slashes and handles empty base", () => {
  expect(deriveWsUrl("https://chat.openchat.dev/")).toBe("wss://chat.openchat.dev//ws");
  expect(deriveWsUrl("")).toBe("/ws");
});
