import { expect, test } from "vite-plus/test";
import { parseClientFrame, messageNewEvent } from "../src/index.ts";

test("parses post_message frame", () => {
  const frame = parseClientFrame(
    JSON.stringify({ type: "post_message", channelId: "c1", content: "hi", clientToken: "t1" }),
  );
  expect(frame?.type).toBe("post_message");
});

test("message.new event shape", () => {
  const ev = messageNewEvent("c1", {
    id: "m1",
    seq: 1,
    userId: "u1",
    type: "text",
    content: "hi",
    createdAt: 1,
    parentId: null,
    attachments: null,
    mentions: null,
    editedAt: null,
    deletedAt: null,
  });
  expect(ev.type).toBe("message.new");
  expect(ev.channelId).toBe("c1");
});
