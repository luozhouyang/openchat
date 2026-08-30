import { expect, test } from "vite-plus/test";
import { parseClientFrame } from "../src/index.ts";

test("parses presence_subscribe frame", () => {
  const frame = parseClientFrame(
    JSON.stringify({ type: "presence_subscribe", userIds: ["u1", "u2"] }),
  );
  expect(frame?.type).toBe("presence_subscribe");
});

test("presence_subscribe rejects >200 users", () => {
  const ids = Array.from({ length: 201 }, (_, i) => `u${i}`);
  expect(parseClientFrame(JSON.stringify({ type: "presence_subscribe", userIds: ids }))).toBeNull();
});
