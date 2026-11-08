import { expect, test } from "@jest/globals";
import { notificationLabel } from "../src/lib/notifications";

test("labels inbox kinds for the mobile notification list", () => {
  expect(notificationLabel("mention")).toBe("提及");
  expect(notificationLabel("reply")).toBe("回复");
  expect(notificationLabel("dm")).toBe("私信");
});
