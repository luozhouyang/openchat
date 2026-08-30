interface ThumbnailEnv {
  FILES: R2Bucket;
  THUMBNAIL_API_BASE: string;
  INTERNAL_TOKEN_KEY: string;
}

export async function handleR2Event(
  event: { key: string; contentType?: string; size: number },
  env: ThumbnailEnv,
): Promise<void> {
  if (!event.key.startsWith("uploads/")) return;
  if (!event.contentType?.startsWith("image/")) return;
  if (event.size > 2 * 1024 * 1024) return;

  const original = await env.FILES.get(event.key);
  if (!original) return;

  const thumbKey = `thumbnails/${event.key}`;
  const existing = await env.FILES.head(thumbKey);
  if (existing) return;

  const resized = await resizeImage(original.body as ReadableStream, 320);
  if (!resized) return;
  await env.FILES.put(thumbKey, resized, { httpMetadata: { contentType: "image/webp" } });

  const parts = event.key.split("/");
  const channelId = parts[1];
  const uploadId = parts[2];
  await notifyChannel(env, channelId, uploadId, thumbKey);
}

async function resizeImage(stream: ReadableStream, maxWidth: number): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  void maxWidth;
  return out;
}

async function notifyChannel(
  env: ThumbnailEnv,
  channelId: string,
  uploadId: string,
  thumbKey: string,
): Promise<void> {
  const res = await fetch(`${env.THUMBNAIL_API_BASE}/internal/thumbnail`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-token": env.INTERNAL_TOKEN_KEY,
    },
    body: JSON.stringify({ channelId, uploadId, thumbKey }),
  });
  if (!res.ok) console.error("thumbnail notify failed", res.status);
}
