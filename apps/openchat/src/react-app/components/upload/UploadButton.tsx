import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PostAttachment } from "protocol";
import { api } from "@/lib/api";

export function UploadButton({
  channelId,
  mode = "message",
  onUploaded,
  onAttached,
}: {
  channelId: string;
  /**
   * "message" posts the file as its own message (legacy flow);
   * "attach" finishes the upload and hands the descriptor back to the
   * composer so it can be sent together with the text draft.
   */
  mode?: "message" | "attach";
  onUploaded?: () => void;
  onAttached?: (attachment: PostAttachment) => void;
}) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  async function upload(file: File) {
    setFailed(false);
    setProgress(0);
    try {
      const res = await api.uploads.create({
        channelId,
        filename: file.name,
        size: file.size,
        contentType: file.type || "application/octet-stream",
      });
      const put = await fetch(res.putUrl, {
        method: "PUT",
        body: file,
        headers: { "content-type": file.type || "application/octet-stream" },
      });
      if (!put.ok) {
        throw new Error(`upload failed: ${put.status}`);
      }
      setProgress(100);
      if (mode === "attach") {
        const attached = await api.uploads.attach(res.uploadId);
        onAttached?.(attached.attachment);
      } else {
        await api.uploads.complete(res.uploadId);
        onUploaded?.();
      }
    } catch {
      setFailed(true);
    } finally {
      setProgress(null);
    }
  }

  const busy = progress !== null;

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) {
            void upload(file);
          }
        }}
      />
      <button
        type="button"
        aria-label={t("messages.upload")}
        title={failed ? t("messages.uploadFailed") : t("messages.upload")}
        className={`shrink-0 rounded px-2 py-2 text-sm hover:bg-accent ${
          failed ? "text-destructive" : "text-muted-foreground"
        }`}
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        {busy ? `${progress}%` : "📎"}
      </button>
    </>
  );
}
