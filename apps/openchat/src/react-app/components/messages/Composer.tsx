import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PostAttachment } from "protocol";
import { appClient } from "@/app-client";
import { wsClient } from "@/ws/client";
import { useMe } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { UploadButton } from "@/components/upload/UploadButton";

const MAX_TEXTAREA_HEIGHT = 160;

export function Composer({ channelId }: { channelId: string }) {
  const { t } = useTranslation();
  const me = useMe();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<PostAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const lastTypingSent = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = text.trim().length > 0 || attachments.length > 0;

  // Grow with the draft up to a cap, then scroll inside the textarea.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [text]);

  async function send() {
    const content = text.trim();
    if (!canSend || sending) {
      return;
    }
    setSending(true);
    setFailed(false);
    setText("");
    // Seed the optimistic row with the real author id so it renders the
    // sender's name/avatar instead of the placeholder "me".
    const ok = await appClient.messages.send(channelId, content, crypto.randomUUID(), {
      ...(me ? { userId: me.id } : {}),
      attachments,
      type: attachments.length > 0 && content === "" ? "file" : "text",
    });
    setSending(false);
    if (ok) {
      setAttachments([]);
    } else {
      // Failed send restores the draft and surfaces the failure inline.
      setText(content);
      setFailed(true);
    }
  }

  return (
    <div className="border-t p-3">
      {failed && (
        <div role="alert" className="mb-2 text-xs text-destructive">
          {t("messages.sendFailed")}
        </div>
      )}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <span
              key={attachment.fileId}
              className="flex items-center gap-2 rounded border bg-muted/40 px-2 py-1 text-xs"
            >
              <span className="max-w-48 truncate">{attachment.name ?? attachment.fileId}</span>
              <button
                type="button"
                aria-label={t("messages.removeAttachment")}
                className="text-muted-foreground hover:text-destructive"
                onClick={() =>
                  setAttachments((current) =>
                    current.filter((item) => item.fileId !== attachment.fileId),
                  )
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <UploadButton
          channelId={channelId}
          mode="attach"
          onAttached={(attachment) =>
            setAttachments((current) =>
              current.some((item) => item.fileId === attachment.fileId)
                ? current
                : [...current, attachment],
            )
          }
        />
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          placeholder={t("messages.composerPlaceholder")}
          aria-label={t("messages.composerPlaceholder")}
          className="max-h-40 flex-1 resize-none rounded border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          onChange={(e) => {
            setText(e.target.value);
            if (failed) {
              setFailed(false);
            }
            const now = Date.now();
            if (now - lastTypingSent.current > 3000) {
              lastTypingSent.current = now;
              wsClient.send({ type: "typing", channelId });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button onClick={() => void send()} disabled={!canSend || sending}>
          {t("messages.send")}
        </Button>
      </div>
    </div>
  );
}
