import { expect, test } from "@jest/globals";
import { notificationKindKey } from "../src/lib/notifications";

test("maps inbox kinds to translation keys", () => {
  expect(notificationKindKey("mention")).toBe("kindMention");
  expect(notificationKindKey("reply")).toBe("kindReply");
  expect(notificationKindKey("dm")).toBe("kindDm");
});
