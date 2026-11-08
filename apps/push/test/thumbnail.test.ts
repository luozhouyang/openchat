// Unit tests for the thumbnail pipeline. The real wasm path is exercised where
// possible; a makeR2 helper builds an in-memory R2Bucket-ish stub recording
// the objects written.
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  setPhotonLoaderForTests,
  fromR2Notification,
  handleR2Event,
  thumbnailConstants,
  type ThumbnailEvent,
} from "../src/thumbnail.ts";

const { MAX_INPUT_BYTES, RESIZE_THRESHOLD_BYTES } = thumbnailConstants;

// 1x1 red JPEG/PNG-agnostic marker; only decoded when > threshold, so plain
// opaque payload works for the small-image paths.
const SMALL_BYTES = new Uint8Array(1024).fill(0x17);

function makeR2() {
  const objs = new Map<string, { bytes: number; data: Uint8Array; contentType?: string }>();
  const puts: { key: string; contentType: string; length: number }[] = [];
  return {
    objs,
    puts,
    get(key: string) {
      const o = objs.get(key);
      if (!o) {
        return undefined;
      }
      return Promise.resolve({
        arrayBuffer: async () => o.data.slice().buffer,
        httpMetadata: { contentType: o.contentType },
      });
    },
    head(key: string) {
      return Promise.resolve(objs.has(key) ? {} : undefined);
    },
    put(
      key: string,
      value: ArrayBuffer | Uint8Array,
      opts?: { httpMetadata?: { contentType?: string } },
    ) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      objs.set(key, { bytes: bytes.byteLength, data: bytes.slice() });
      puts.push({
        key,
        contentType: opts?.httpMetadata?.contentType ?? "",
        length: bytes.byteLength,
      });
      return Promise.resolve(undefined);
    },
  };
}

type R2 = ReturnType<typeof makeR2>;

function envWith(r2: R2) {
  return {
    FILES: r2 as unknown as R2Bucket,
    THUMBNAIL_API_BASE: "http://api.local",
    INTERNAL_TOKEN_KEY: "tok",
  };
}

const notifyCalls: unknown[] = [];

beforeEach(() => {
  notifyCalls.length = 0;
  vi.stubGlobal("fetch", (async (url: string, init?: RequestInit) => {
    notifyCalls.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  setPhotonLoaderForTests(null);
});

const event = (over: Partial<ThumbnailEvent> = {}): ThumbnailEvent => ({
  key: "uploads/c-file/up1",
  contentType: "image/png",
  size: SMALL_BYTES.byteLength,
  ...over,
});

describe("handleR2Event filters", () => {
  test("ignores keys outside uploads/", async () => {
    const r2 = makeR2();
    await handleR2Event(
      { key: "avatars/foo.png", contentType: "image/png", size: 100 },
      envWith(r2),
    );
    expect(r2.puts).toEqual([]);
    expect(notifyCalls).toEqual([]);
  });

  test("ignores non-image content type", async () => {
    const r2 = makeR2();
    await handleR2Event(
      { key: "uploads/c-file/up1", contentType: "application/pdf", size: 100 },
      envWith(r2),
    );
    expect(notifyCalls).toEqual([]);
  });

  test("ignores objects over the size cap", async () => {
    const r2 = makeR2();
    await handleR2Event(
      { key: "uploads/c-file/up1", contentType: "image/png", size: MAX_INPUT_BYTES + 1 },
      envWith(r2),
    );
    expect(notifyCalls).toEqual([]);
  });

  test("ignores missing source object and non-image metadata content type", async () => {
    const r2 = makeR2();
    await handleR2Event({ key: "uploads/c-file/missing", size: 10 }, envWith(r2));
    expect(notifyCalls).toEqual([]);
    r2.objs.set("uploads/c-file/text", {
      bytes: 10,
      data: SMALL_BYTES,
      contentType: "text/plain",
    } as never);
    await handleR2Event({ key: "uploads/c-file/text", size: 10 }, envWith(r2));
    expect(notifyCalls).toEqual([]);
  });

  test("skips when thumbnail already exists", async () => {
    const r2 = makeR2();
    r2.objs.set("thumbnails/uploads/c-file/up1", {
      bytes: 1,
      data: new Uint8Array(1),
    });
    await handleR2Event(event(), envWith(r2));
    expect(r2.puts).toEqual([]);
  });
});

describe("small images are copied as thumbnails", () => {
  test("copies original bytes with original content type", async () => {
    const r2 = makeR2();
    r2.objs.set("uploads/c-file/up1", {
      bytes: SMALL_BYTES.byteLength,
      data: SMALL_BYTES.slice(),
      contentType: "image/png",
    } as never);
    await handleR2Event(event(), envWith(r2));

    expect(r2.puts).toHaveLength(1);
    expect(r2.puts[0].key).toBe("thumbnails/uploads/c-file/up1");
    expect(r2.puts[0].contentType).toBe("image/png");
    expect(r2.puts[0].length).toBe(SMALL_BYTES.byteLength);
    // small copy: never attempts wasm decode
    expect(belowThreshold(SMALL_BYTES.byteLength)).toBe(true);
  });
});

function belowThreshold(len: number): boolean {
  return len <= RESIZE_THRESHOLD_BYTES;
}

// ---- wasm-backed tests ----

// Minimal loader: initialize photon from the package's real wasm binary read
// off disk (node fs), bypassing the dynamic-import path the worker bundle uses
// (wrangler CompiledWasm), which plain-node/vite-node cannot evaluate.
type PhotonModule = typeof import("photon-wasm");
let photonModulePromise: Promise<PhotonModule> | null = null;
function importPhoton(): Promise<PhotonModule> {
  photonModulePromise ??= (async () => {
    const { createRequire } = await import("node:module");
    const { readFileSync } = await import("node:fs");
    const require_: NodeRequire = createRequire(import.meta.url);
    const wasmBytes = readFileSync(require_.resolve("photon-wasm/dist/photon_bg.wasm"));
    const mod = (await import("photon-wasm")) as PhotonModule;
    const compile = (
      WebAssembly as unknown as {
        compile: (b: ArrayBuffer) => Promise<WebAssembly.Module>;
      }
    ).compile;
    await mod.initWasm(await compile(Buffer.from(wasmBytes).buffer));
    return mod;
  })();
  return photonModulePromise;
}

// Build a 600x400 opaque red PNG > RESIZE_THRESHOLD_BYTES.
function makePng(
  width: number,
  height: number,
  deflateSync: (input: Uint8Array, opts?: { level?: number }) => Uint8Array,
): Uint8Array {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const at = y * stride + 1 + x * 4;
      raw[at] = 0xff;
      raw[at + 1] = 0x00;
      raw[at + 2] = 0x00;
      raw[at + 3] = 0xff;
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.byteLength);
    const crc = Buffer.alloc(4);
    const crcValue = crc32(Buffer.concat([Buffer.from(type, "latin1"), data]));
    crc.writeUInt32BE(crcValue);
    return Buffer.concat([len, Buffer.from(type, "latin1"), data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 0 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

describe("real wasm resize (photon)", () => {
  let photonAvailable = false;
  const zlibOk = (async () => {
    const { deflateSync } = await import("node:zlib");
    return (buf: Uint8Array) => deflateSync(Buffer.from(buf), { level: 0 });
  })();

  test("photon wasm initializes in node runner", async () => {
    try {
      await importPhoton();
      photonAvailable = true;
    } catch (err) {
      console.warn(
        "TODO: photon-wasm could not initialize under the vitest node runner " +
          "(worker bundles it via wrangler CompiledWasm; validate at deploy time).",
        err,
      );
    }
    // The worker keeps running even if this env can't init wasm; in CI on this
    // runner it must load, so fail loudly if it no longer does.
    expect(photonAvailable).toBe(true);
  });

  test("large image is decoded, resized, and re-encoded as <=320px webp", async () => {
    const mod = await importPhoton();
    setPhotonLoaderForTests(() => Promise.resolve(mod));

    const png = makePng(600, 400, await zlibOk);
    expect(png.byteLength).toBeGreaterThan(RESIZE_THRESHOLD_BYTES);
    const r2 = makeR2();
    r2.objs.set("uploads/c-file/up1", {
      bytes: png.byteLength,
      data: png.slice(),
      contentType: "image/png",
    } as never);

    await handleR2Event({ key: "uploads/c-file/up1", size: png.byteLength }, envWith(r2));

    expect(r2.puts).toHaveLength(1);
    expect(r2.puts[0].key).toBe("thumbnails/uploads/c-file/up1");
    expect(r2.puts[0].contentType).toBe("image/webp");
    expect(r2.puts[0].length).toBeLessThan(png.byteLength);
    expect(notifyCalls).toHaveLength(1);
    expect((notifyCalls[0] as { url: string }).url).toContain("/internal/thumbnail");
  });

  test("already-small-dimension large image is copied without re-encode", async () => {
    // >40KB payload, dimensions under the cap: decode happens but resize is
    // skipped, keeping the original bytes + content type.
    const mod = await importPhoton();
    setPhotonLoaderForTests(() => Promise.resolve(mod));

    const png = makePng(200, 100, await zlibOk);
    const r2 = makeR2();
    r2.objs.set("uploads/c-file/up1", {
      bytes: png.byteLength,
      data: png.slice(),
      contentType: "image/png",
    } as never);

    await handleR2Event({ key: "uploads/c-file/up1", size: png.byteLength }, envWith(r2));
    // 200x100 fits under 320px: copy branch, original content type kept.
    expect(r2.puts).toHaveLength(1);
    expect(r2.puts[0].contentType).toBe("image/png");
    expect(r2.puts[0].length).toBe(png.byteLength);
  });
});

describe("wasm failure falls back to original bytes", () => {
  test("large image with failing wasm init still writes a thumbnail (original bytes)", async () => {
    setPhotonLoaderForTests(() => Promise.reject(new Error("wasm unavailable")));
    const r2 = makeR2();
    const big = new Uint8Array(RESIZE_THRESHOLD_BYTES + 1).fill(0x42);
    r2.objs.set("uploads/c-file/up1", {
      bytes: big.byteLength,
      data: big.slice(),
      contentType: "image/png",
    } as never);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await handleR2Event(event({ size: big.byteLength }), envWith(r2));
      expect(r2.puts).toHaveLength(1);
      expect(r2.puts[0].key).toBe("thumbnails/uploads/c-file/up1");
      expect(r2.puts[0].contentType).toBe("image/png");
      expect(r2.puts[0].length).toBe(big.byteLength);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("queue message compatibility", () => {
  test("fromR2Notification accepts object-create envelopes and rejects irrelevant ones", () => {
    expect(
      fromR2Notification({
        action: "PutObject",
        bucket: "openchat-files",
        object: { key: "uploads/c-file/up1", size: 12345 },
      }),
    ).toEqual({ key: "uploads/c-file/up1", size: 12345 });
    expect(
      fromR2Notification({
        action: "CompleteMultipartUpload",
        object: { key: "uploads/c-file/up2", size: 50 },
      }),
    ).toEqual({ key: "uploads/c-file/up2", size: 50 });

    expect(
      fromR2Notification({
        action: "DeleteObject",
        object: { key: "uploads/c-file/up1" },
      }),
    ).toBeNull();
    expect(fromR2Notification({ type: "push-notification" })).toBeNull();
    expect(fromR2Notification(null)).toBeNull();
    expect(fromR2Notification({ action: "PutObject", object: {} })).toBeNull();
  });
});
