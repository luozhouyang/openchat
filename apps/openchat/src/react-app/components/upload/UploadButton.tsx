import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PostAttachment } from "protocol";
import { uploadAttachment } from "@/lib/upload";

export function UploadButton({
  channelId,
  onAttached,
}: {
  channelId: string;
  onAttached: (attachment: PostAttachment) => void;
}) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  async function upload(file: File) {
    setFailed(false);
    setProgress(0);
    try {
      const attachment = await uploadAttachment(channelId, file, setProgress);
      onAttached(attachment);
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
