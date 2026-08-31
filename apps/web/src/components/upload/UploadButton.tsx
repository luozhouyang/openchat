import { useRef, useState } from "react";
import { apiFetch } from "../../lib/api";

export function UploadButton({
  channelId,
  onUploaded,
}: {
  channelId: string;
  onUploaded: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);

  async function upload(file: File) {
    setProgress(0);
    const res = await apiFetch<{ uploadId: string; putUrl: string }>("/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channelId,
        filename: file.name,
        size: file.size,
        contentType: file.type,
      }),
    });
    await fetch(res.putUrl, {
      method: "PUT",
      body: file,
      headers: { "content-type": file.type },
    });
    setProgress(100);
    await fetch("/uploads/complete", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId: res.uploadId }),
    });
    setProgress(null);
    onUploaded();
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
      />
      <button className="text-sm text-zinc-500" onClick={() => fileRef.current?.click()}>
        {progress !== null ? `上传中 ${progress}%` : "📎"}
      </button>
    </>
  );
}
