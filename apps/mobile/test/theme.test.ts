import { expect, test } from "@jest/globals";
import { paletteFor } from "../src/lib/theme";

test("explicit modes win over the system scheme", () => {
  expect(paletteFor("light", "dark").bg).toBe("#ffffff");
  expect(paletteFor("dark", "light").bg).toBe("#111827");
});

test("system mode follows the device scheme", () => {
  expect(paletteFor("system", "dark").bg).toBe("#111827");
  expect(paletteFor("system", "light").bg).toBe("#ffffff");
  expect(paletteFor("system", null).bg).toBe("#ffffff");
});
