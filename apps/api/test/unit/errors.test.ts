import { expect, test } from "vite-plus/test";
import { apiError, HttpError } from "../../src/lib/errors.ts";

test("HttpError carries code, message, and status", () => {
  const err = new HttpError("NOT_FOUND", "nope", 404);
  expect(err).toBeInstanceOf(Error);
  expect(err.code).toBe("NOT_FOUND");
  expect(err.message).toBe("nope");
  expect(err.status).toBe(404);
});

test("HttpError defaults status to 400", () => {
  const err = new HttpError("BAD_REQUEST", "bad request");
  expect(err.status).toBe(400);
});

test("apiError returns an HttpError", () => {
  const err = apiError("FORBIDDEN", "forbidden", 403);
  expect(err).toBeInstanceOf(HttpError);
  expect(err.code).toBe("FORBIDDEN");
  expect(err.message).toBe("forbidden");
  expect(err.status).toBe(403);
});

test("apiError defaults status to 400", () => {
  expect(apiError("BAD", "bad").status).toBe(400);
});
