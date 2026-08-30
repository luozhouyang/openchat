import { expect, test } from "vite-plus/test";
import { CreateTeamInput, OpenGmInput } from "../src/index.ts";

test("create team input validates", () => {
  expect(CreateTeamInput.parse({ name: "acme", displayName: "Acme", type: "open" }).name).toBe(
    "acme",
  );
  expect(() =>
    CreateTeamInput.parse({ name: "bad name!", displayName: "x", type: "open" }),
  ).toThrow();
});

test("gm input bounds", () => {
  expect(() => OpenGmInput.parse({ userIds: ["a", "b"] })).toThrow();
  expect(OpenGmInput.parse({ userIds: ["a", "b", "c"] }).userIds).toHaveLength(3);
});
