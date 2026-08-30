import { expect, test } from "vite-plus/test";
import { newId, userDoName, channelDoName } from "../src/index.ts";

test("newId returns 26-char ULID", () => {
  expect(newId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
});

test("DO naming rules", () => {
  expect(userDoName("u1")).toBe("user:u1");
  expect(channelDoName("c1")).toBe("channel:c1");
});
