interface ThumbnailEnv {
  FILES: R2Bucket;
  THUMBNAIL_API_BASE: string;
  INTERNAL_TOKEN_KEY: string;
}

// R2 event-notification message body shape as delivered by
// `wrangler r2 bucket notification create` / Dashboard rules (not declarable
// in wrangler.jsonc). See
// https://developers.cloudflare.com/r2/buckets/event-notifications/
interface R2NotificationEnvelope {
  action: string;
  bucket?: string;
  object?: { key?: string; size?: number };
}

export interface ThumbnailEvent {
  key: string;
  contentType?: string;
  size?: number;
}

const MAX_DIMENSION = 320;
// Above this, don't even attempt a decode+resize (memory headroom on Workers).
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
// Below this, resizing is pointless — just copy the original bytes as the
// thumbnail (identical to the pre-resize behaviour for small images).
const RESIZE_THRESHOLD_BYTES = 40 * 1024;

export async function handleR2Event(event: ThumbnailEvent, env: ThumbnailEnv): Promise<void> {
  if (!event.key.startsWith("uploads/")) {
    return;
  }
  const contentType = event.contentType;
  if (contentType && !contentType.startsWith("image/")) {
    return;
  }
  if (event.size != null && event.size > MAX_INPUT_BYTES) {
    return;
  }

  const original = await env.FILES.get(event.key);
  if (!original) {
    return;
  }

  // Event notifications do not carry content-type; fall back to the object's
  // own http metadata so both producer paths (r2-thumbnail task and R2
  // notification envelope) are covered.
  const type = contentType ?? original.httpMetadata?.contentType;
  if (!type?.startsWith("image/")) {
    return;
  }

  const thumbKey = `thumbnails/${event.key}`;
  const existing = await env.FILES.head(thumbKey);
  if (existing) {
    return;
  }

  const bytes = await original.arrayBuffer();
  const thumb = await produceThumbnail(bytes, type);
  await env.FILES.put(thumbKey, thumb.bytes, {
    httpMetadata: { contentType: thumb.contentType },
  });

  const parts = event.key.split("/");
  const channelId = parts[1];
  const uploadId = parts[2];
  await notifyChannel(env, channelId, uploadId, thumbKey);
}

interface Thumbnail {
  bytes: Uint8Array;
  contentType: string;
}

// Decode + resize + re-encode with photon (Rust image library compiled to
// wasm). Never throws: any failure (unsupported format, wasm init error, OOM)
// falls back to copying the original bytes so the queue message is always
// consumed in this attempt without a retry/dead-letter loop.
async function produceThumbnail(bytes: ArrayBuffer, contentType: string): Promise<Thumbnail> {
  if (bytes.byteLength <= RESIZE_THRESHOLD_BYTES) {
    return { bytes: new Uint8Array(bytes), contentType };
  }
  try {
    const photon = await ensurePhoton();
    if (!photon) {
      throw new Error("photon-wasm unavailable");
    }
    const img = photon.PhotonImage.new_from_byteslice(new Uint8Array(bytes));
    const width = img.get_width();
    const height = img.get_height();
    if (width === 0 || height === 0) {
      throw new Error("zero-size image");
    }
    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
    if (scale >= 1) {
      // Already at most 320px on its longest side — nothing to gain.
      return { bytes: new Uint8Array(bytes), contentType };
    }
    const out = photon.resize(
      img,
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(height * scale)),
      photon.SamplingFilter.Triangle,
    );
    return { bytes: out.get_bytes_webp(), contentType: "image/webp" };
  } catch (err) {
    console.error("thumbnail resize failed; falling back to original bytes", err);
    return { bytes: new Uint8Array(bytes), contentType };
  }
}

type PhotonModule = typeof import("photon-wasm");
type PhotonLoader = () => Promise<PhotonModule>;
let testLoader: PhotonLoader | null = null;
let photonInit: Promise<PhotonModule | null> | null = null;

/**
 * Test-only seam: replaces the default lazily-imported wasm loader. Must be
 * called before any event is handled (the init is single-flight and sticky).
 */
export function setPhotonLoaderForTests(loader: PhotonLoader | null): void {
  testLoader = loader;
  photonInit = null;
}

/**
 * Single-flight photon init. The .wasm module is imported lazily so paths that
 * never hit the resize branch (and vitest's plain-node runner) don't need
 * wasm support. Wrangler bundles the dynamic import as a CompiledWasm module
 * (ES module workers import .wasm directly; import value is a
 * WebAssembly.Module).
 */
function ensurePhoton(): Promise<PhotonModule | null> {
  photonInit ??= (
    testLoader
      ? testLoader()
      : (async () => {
          const [mod, wasm] = await Promise.all([
            import("photon-wasm"),
            import("photon-wasm/dist/photon_bg.wasm"),
          ]);
          await mod.initWasm(wasm.default as unknown as WebAssembly.Module);
          return mod;
        })()
  ).catch((err) => {
    // Sticky failure: don't re-attempt per queue message.
    console.error("photon-wasm failed to initialize; thumbnails disabled", err);
    return null;
  });
  return photonInit;
}

async function notifyChannel(
  env: ThumbnailEnv,
  channelId: string,
  uploadId: string,
  thumbKey: string,
): Promise<void> {
  // The worker validates /internal/* tokens with verifyInternalToken +
  // timing-safe `internal:*` subject check (routes/internal.ts) — raw secret
  // in the header is no longer accepted. Signer mirrors issueInternalToken in
  // packages/protocol and the copy in push.ts (no protocol dep here).
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(env.INTERNAL_TOKEN_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const b64url = (data: Uint8Array): string => {
    let s = "";
    for (const b of data) {
      s += String.fromCharCode(b);
    }
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(
    enc.encode(JSON.stringify({ sub: "internal:thumbnail", iat: now, exp: now + 60 })),
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${payload}`));
  const token = `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
  const res = await fetch(`${env.THUMBNAIL_API_BASE}/internal/thumbnail`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-token": token,
    },
    body: JSON.stringify({ channelId, uploadId, thumbKey }),
  });
  if (!res.ok) {
    console.error("thumbnail notify failed", res.status);
  }
}

/**
 * Map an R2 event-notification queue message (produced by
 * `wrangler r2 bucket notification create --event-type object-create`) to a
 * ThumbnailEvent, or null when the message isn't a relevant object write.
 */
export function fromR2Notification(message: unknown): ThumbnailEvent | null {
  const body = message as Partial<R2NotificationEnvelope> | null;
  if (!body || typeof body.action !== "string") {
    return null;
  }
  // object-create rules also fire for CompleteMultipartUpload/CopyObject.
  if (
    body.action !== "PutObject" &&
    body.action !== "CopyObject" &&
    body.action !== "CompleteMultipartUpload"
  ) {
    return null;
  }
  if (typeof body.object?.key !== "string") {
    return null;
  }
  return { key: body.object.key, size: body.object.size };
}

// Exported for tests.
export const thumbnailConstants = {
  MAX_DIMENSION,
  MAX_INPUT_BYTES,
  RESIZE_THRESHOLD_BYTES,
};
