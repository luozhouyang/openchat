import { expect, test } from "vite-plus/test";
import { CreateTeamInput, OpenGroupInput } from "../src/index.ts";

test("create team input validates", () => {
  expect(CreateTeamInput.parse({ name: "acme", displayName: "Acme", type: "open" }).name).toBe(
    "acme",
  );
  expect(() =>
    CreateTeamInput.parse({ name: "bad name!", displayName: "x", type: "open" }),
  ).toThrow();
});

test("group input bounds", () => {
  expect(OpenGroupInput.parse({ userIds: ["a", "b"] }).userIds).toHaveLength(2);
  expect(() => OpenGroupInput.parse({ userIds: ["a"] })).toThrow();
});
