import { expect, test } from "@jest/globals";
import { translate, translationKeys } from "../src/lib/i18n";

test("translates mobile strings in both languages", () => {
  expect(translate("zh", "channels")).toBe("频道");
  expect(translate("en", "channels")).toBe("Channels");
  expect(translate("zh", "login")).toBe("登录");
  expect(translate("en", "login")).toBe("Sign in");
});

test("every key is translated in both languages", () => {
  for (const key of translationKeys) {
    expect(translate("zh", key)).toBeTruthy();
    expect(translate("en", key)).toBeTruthy();
  }
});
