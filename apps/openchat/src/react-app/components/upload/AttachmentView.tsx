import type { StoreMessage } from "@/stores/messages";

export function AttachmentView({
  message,
  channelId,
}: {
  message: StoreMessage;
  channelId: string;
}) {
  if (!message.attachments || message.attachments.length === 0) {
    return null;
  }
  return (
    <div className="mt-1 flex gap-2">
      {message.attachments.map((a, i) => {
        const att = a as { fileId: string; name: string; mime: string; thumbUrl?: string };
        const href = `/files/${channelId}/${att.fileId}`;
        if (att.mime.startsWith("image/")) {
          return (
            <a key={i} href={href} target="_blank" rel="noreferrer">
              <img
                src={att.thumbUrl ?? href}
                alt={att.name}
                className="max-h-48 rounded border"
                loading="lazy"
              />
            </a>
          );
        }
        return (
          <a key={i} href={href} className="rounded border px-3 py-2 text-sm" download>
            {att.name}
          </a>
        );
      })}
    </div>
  );
}
