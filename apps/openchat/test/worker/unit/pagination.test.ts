import { expect, test } from "vite-plus/test";
import { parsePage } from "@worker/lib/pagination";

test("parsePage defaults to page 0 and perPage 60", () => {
  expect(parsePage(new URLSearchParams())).toEqual({ page: 0, perPage: 60 });
});

test("parsePage parses page and per_page", () => {
  expect(parsePage(new URLSearchParams("page=3&per_page=25"))).toEqual({ page: 3, perPage: 25 });
});

test("parsePage clamps perPage to max 200", () => {
  expect(parsePage(new URLSearchParams("per_page=999"))).toEqual({ page: 0, perPage: 200 });
});

test("parsePage clamps perPage to min 1", () => {
  expect(parsePage(new URLSearchParams("per_page=-5"))).toEqual({ page: 0, perPage: 1 });
});

test("parsePage treats per_page=0 as default", () => {
  expect(parsePage(new URLSearchParams("per_page=0"))).toEqual({ page: 0, perPage: 60 });
});

test("parsePage never goes below page 0", () => {
  expect(parsePage(new URLSearchParams("page=-2"))).toEqual({ page: 0, perPage: 60 });
});

test("parsePage falls back on non-numeric input", () => {
  expect(parsePage(new URLSearchParams("page=abc&per_page=xyz"))).toEqual({ page: 0, perPage: 60 });
});
