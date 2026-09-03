import { expect, test } from "vite-plus/test";
import { apiError, HttpError, isHttpError, toErrorBody } from "../../../src/worker/lib/errors.ts";

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

test("apiError creates HttpError with code/status", () => {
  const err = apiError("forbidden", "not allowed", 403);
  expect(err.code).toBe("forbidden");
  expect(err.status).toBe(403);
  expect(err.message).toBe("not allowed");
  expect(isHttpError(err)).toBe(true);
});

test("isHttpError is false for plain errors", () => {
  expect(isHttpError(new Error("boom"))).toBe(false);
});

test("isHttpError is false for non-error values", () => {
  expect(isHttpError(null)).toBe(false);
  expect(isHttpError({ code: "x" })).toBe(false);
  expect(isHttpError("string")).toBe(false);
});

test("toErrorBody returns error/code and omits details when absent", () => {
  const err = apiError("FORBIDDEN", "forbidden", 403);
  expect(toErrorBody(err)).toEqual({ error: "forbidden", code: "FORBIDDEN" });
});

test("toErrorBody includes details when set", () => {
  const err = apiError("BAD", "bad", 400, "extra context");
  expect(toErrorBody(err)).toEqual({
    error: "bad",
    code: "BAD",
    details: "extra context",
  });
});
