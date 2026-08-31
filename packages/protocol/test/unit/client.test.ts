import { expect, test, vi } from "vite-plus/test";
import { apiFetch, ApiError } from "../../src/client.ts";

test("apiFetch resolves json on ok", async () => {
  const res = new Response(JSON.stringify({ ok: true }), { status: 200 });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
  expect(await apiFetch<{ ok: boolean }>("/x")).toEqual({ ok: true });
  vi.unstubAllGlobals();
});

test("apiFetch throws ApiError on !ok", async () => {
  const res = new Response(JSON.stringify({ error: "forbidden", code: "forbidden" }), {
    status: 403,
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
  const err = await apiFetch<unknown>("/x").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status: 403 });
  vi.unstubAllGlobals();
});
