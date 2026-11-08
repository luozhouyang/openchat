import { useTranslation } from "react-i18next";
import type { StoreMessage } from "@/stores/messages";

interface AttachmentLike {
  fileId?: string;
  name?: string;
  mime?: string;
  thumbUrl?: string;
}

/** Same-origin file routes; cookies authenticate both <img> and downloads. */
function fileUrl(fileId: string): string {
  return `/api/v1/files/${fileId}`;
}

export function AttachmentView({ message }: { message: StoreMessage }) {
  const { t } = useTranslation();
  const attachments = (message.attachments ?? [])
    .map((a) => a as AttachmentLike)
    .filter((a): a is AttachmentLike & { fileId: string } => typeof a.fileId === "string");

  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {attachments.map((att) => {
        const href = fileUrl(att.fileId);
        if (att.mime?.startsWith("image/")) {
          return (
            <a key={att.fileId} href={href} target="_blank" rel="noreferrer">
              <img
                src={att.thumbUrl ?? `${href}/thumbnail`}
                alt={att.name ?? t("messages.image")}
                className="max-h-48 rounded border"
                loading="lazy"
                // Thumbnails are generated asynchronously; fall back to the
                // original file when the thumbnail route has nothing yet.
                onError={(e) => {
                  if (e.currentTarget.getAttribute("src") !== href) {
                    e.currentTarget.src = href;
                  }
                }}
              />
            </a>
          );
        }
        return (
          <a
            key={att.fileId}
            href={href}
            className="rounded border px-3 py-2 text-sm hover:bg-accent"
            download
          >
            {att.name ?? t("messages.file")}
          </a>
        );
      })}
    </div>
  );
}
