import { expect, test } from "@jest/globals";
import { personLabel, presenceColor } from "../src/lib/people";

test("prefers nickname, then name, then username, then the id", () => {
  expect(
    personLabel(
      { id: "u1", nickname: "Nick", name: "Name", username: "user", avatarUrl: null },
      "u1",
    ),
  ).toBe("Nick");
  expect(
    personLabel(
      { id: "u1", nickname: null, name: "Name", username: "user", avatarUrl: null },
      "u1",
    ),
  ).toBe("Name");
  expect(
    personLabel({ id: "u1", nickname: null, name: null, username: "user", avatarUrl: null }, "u1"),
  ).toBe("user");
  expect(personLabel(undefined, "u1")).toBe("u1");
});

test("maps presence states to stable colors", () => {
  expect(presenceColor("online")).toBe("#22c55e");
  expect(presenceColor("dnd")).toBe("#ef4444");
  expect(presenceColor(undefined)).toBe("#a1a1aa");
  expect(presenceColor("weird")).toBe("#a1a1aa");
});
