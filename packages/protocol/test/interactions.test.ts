import { expect, test } from "vite-plus/test";
import { parseClientFrame, isAllowedEmoji } from "../src/index.ts";

test("parses react frame", () => {
  const frame = parseClientFrame(
    JSON.stringify({ type: "react", channelId: "c1", messageSeq: 1, emoji: "👍" }),
  );
  expect(frame?.type).toBe("react");
});

test("emoji whitelist", () => {
  expect(isAllowedEmoji("👍")).toBe(true);
  expect(isAllowedEmoji("<script>")).toBe(false);
  expect(isAllowedEmoji("👍👍👍👍👍👍👍👍👍")).toBe(false);
});
