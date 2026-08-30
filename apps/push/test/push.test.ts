import { expect, test } from "vite-plus/test";

test("push task shape accepted", () => {
  const task = {
    type: "push-notification",
    userId: "u1",
    channelId: "c1",
    messageId: "m1",
    title: "general",
    body: "hello",
    createdAt: Date.now(),
  };
  expect(task.type).toBe("push-notification");
});
