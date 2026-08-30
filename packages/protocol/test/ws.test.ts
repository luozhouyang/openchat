import { expect, test } from "vite-plus/test";
import { parseClientFrame, helloEvent } from "../src/index.ts";

test("parses echo frame", () => {
  const frame = parseClientFrame(JSON.stringify({ type: "echo", data: "hi" }));
  expect(frame).toEqual({ type: "echo", data: "hi" });
});

test("rejects malformed frame", () => {
  expect(parseClientFrame("not json")).toBeNull();
  expect(parseClientFrame(JSON.stringify({ type: "unknown" }))).toBeNull();
});

test("hello event carries userId", () => {
  const ev = helloEvent("u1");
  expect(ev.type).toBe("hello");
  expect((ev as { userId?: string }).userId).toBe("u1");
});
