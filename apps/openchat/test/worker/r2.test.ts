import { expect, test } from "vite-plus/test";
import { sanitizeFilename } from "../../src/worker/r2.ts";

test("sanitizeFilename strips unsafe chars", () => {
  expect(sanitizeFilename("../../evil.sh")).toBe("evil.sh");
  expect(sanitizeFilename("my file (1).png")).toBe("myfile1.png");
});

test("sanitizeFilename truncates to 255", () => {
  const long = "a".repeat(300);
  expect(sanitizeFilename(long).length).toBeLessThanOrEqual(255);
});

test("sanitizeFilename fallback for empty", () => {
  expect(sanitizeFilename("///")).toBe("file");
});
