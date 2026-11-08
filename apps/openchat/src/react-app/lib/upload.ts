import type { PostAttachment } from "protocol";
import { api } from "@/lib/api";

/**
 * Uploads a file and finishes it with the draft-attach endpoint, so the
 * composer can send it together with the text. Throws on any step failure;
 * callers surface the error inline.
 */
export async function uploadAttachment(
  channelId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<PostAttachment> {
  const contentType = file.type || "application/octet-stream";
  const res = await api.uploads.create({
    channelId,
    filename: file.name || "file",
    size: file.size,
    contentType,
  });
  onProgress?.(10);
  const put = await fetch(res.putUrl, {
    method: "PUT",
    body: file,
    headers: { "content-type": contentType },
  });
  if (!put.ok) {
    throw new Error(`upload failed: ${put.status}`);
  }
  onProgress?.(90);
  const attached = await api.uploads.attach(res.uploadId);
  onProgress?.(100);
  return attached.attachment;
}
