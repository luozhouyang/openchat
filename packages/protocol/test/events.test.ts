import { expect, test } from "vite-plus/test";
import { messageNewEvent } from "../src/index.ts";

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
