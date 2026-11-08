import { expect, test } from "vite-plus/test";
import { parseClientFrame, isAllowedEmoji } from "../src/index.ts";

test("parses react frame", () => {
  const frame = parseClientFrame(
    JSON.stringify({ type: "react", channelId: "c1", messageSeq: 1, emoji: "👍" }),
  );
  expect(frame?.type).toBe("react");
});

test("parses react frame with an optional clientToken (error-frame attribution)", () => {
  const frame = parseClientFrame(
    JSON.stringify({
      type: "react",
      channelId: "c1",
      messageSeq: 1,
      emoji: "👍",
      clientToken: "int_01900000-0000-7000-8000-000000000000",
    }),
  );
  expect(frame?.type).toBe("react");
  expect(frame && frame.type === "react" ? (frame.clientToken ?? null) : null).toBe(
    "int_01900000-0000-7000-8000-000000000000",
  );
});

test("emoji whitelist", () => {
  expect(isAllowedEmoji("👍")).toBe(true);
  expect(isAllowedEmoji("<script>")).toBe(false);
  expect(isAllowedEmoji("👍👍👍👍👍👍👍👍👍")).toBe(false);
});
