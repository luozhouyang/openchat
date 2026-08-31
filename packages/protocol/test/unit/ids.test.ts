import { expect, test } from "vite-plus/test";
import { id, userDoName, channelDoName } from "../../src/index.ts";

test("id prefixes with kind", () => {
  expect(id("team").startsWith("team_")).toBe(true);
  expect(id("chn").startsWith("chn_")).toBe(true);
  expect(id("team")).not.toBe(id("team"));
});

test("id suffix is a uuid v7", () => {
  const v = id("msg").slice("msg_".length);
  expect(v).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("DO naming rules", () => {
  expect(userDoName("u1")).toBe("user:u1");
  expect(channelDoName("c1")).toBe("channel:c1");
});
