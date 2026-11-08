import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ALLOWED_EMOJI, type PostAttachment, type UserAutocompleteItem } from "protocol";
import { appClient } from "@/app-client";
import { wsClient } from "@/ws/client";
import { api } from "@/lib/api";
import { applyMention, detectMention } from "@/lib/mentions";
import { uploadAttachment } from "@/lib/upload";
import { useMe } from "@/hooks/use-me";
import { displayNameOf } from "@/stores/users";
import { Button } from "@/components/ui/button";
import { UploadButton } from "@/components/upload/UploadButton";

const MAX_TEXTAREA_HEIGHT = 160;
const MENTION_LIMIT = 8;

export function Composer({ channelId }: { channelId: string }) {
  const { t } = useTranslation();
  const me = useMe();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<PostAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mention, setMention] = useState<{ start: number; query: string; index: number } | null>(
    null,
  );
  const [candidates, setCandidates] = useState<UserAutocompleteItem[]>([]);
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

  // Debounced user lookup for the active @mention token.
  const mentionQuery = mention?.query ?? null;
  useEffect(() => {
    if (mentionQuery === null) {
      setCandidates([]);
      return;
    }
    let active = true;
    const handle = setTimeout(async () => {
      try {
        const res = await api.users.autocomplete(mentionQuery, MENTION_LIMIT);
        if (active) {
          setCandidates(res.users);
        }
      } catch {
        if (active) {
          setCandidates([]);
        }
      }
    }, 150);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [mentionQuery]);

  function syncMention(value: string, caret: number) {
    const trigger = detectMention(value, caret);
    setMention(trigger ? { ...trigger, index: 0 } : null);
  }

  function selectMention(user: UserAutocompleteItem) {
    if (!mention) {
      return;
    }
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? text.length;
    const next = applyMention(text, caret, mention.start, user.id);
    setText(next.value);
    setMention(null);
    setCandidates([]);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.caret, next.caret);
    });
  }

  function insertEmoji(emoji: string) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  async function addFiles(files: File[]) {
    const uploadable = files.filter((file) => file.size > 0);
    if (uploadable.length === 0) {
      return;
    }
    setFailed(false);
    for (const file of uploadable) {
      setUploading((count) => count + 1);
      try {
        const attachment = await uploadAttachment(channelId, file);
        setAttachments((current) =>
          current.some((item) => item.fileId === attachment.fileId)
            ? current
            : [...current, attachment],
        );
      } catch {
        setFailed(true);
      } finally {
        setUploading((count) => count - 1);
      }
    }
  }

  async function send() {
    const content = text.trim();
    if (!canSend || sending) {
      return;
    }
    setSending(true);
    setFailed(false);
    setText("");
    setMention(null);
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

  const mentionList = useMemo(() => (mention ? candidates : []), [mention, candidates]);

  return (
    <div
      className="relative border-t p-3"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void addFiles([...event.dataTransfer.files]);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded border-2 border-dashed border-primary bg-background/80 text-sm text-primary">
          {t("messages.dropToUpload")}
        </div>
      )}
      {failed && (
        <div role="alert" className="mb-2 text-xs text-destructive">
          {t("messages.sendFailed")}
        </div>
      )}
      {(attachments.length > 0 || uploading > 0) && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
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
          {uploading > 0 && (
            <span className="text-xs text-muted-foreground">{t("messages.uploading")}</span>
          )}
        </div>
      )}
      {mentionList.length > 0 && mention && (
        <div className="absolute bottom-full left-3 z-20 mb-1 w-72 overflow-hidden rounded-md border bg-popover shadow-md">
          {mentionList.map((user, index) => (
            <button
              key={user.id}
              type="button"
              // Keep focus in the textarea while clicking a candidate.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectMention(user)}
              className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent ${
                index === mention.index ? "bg-accent" : ""
              }`}
            >
              <span className="truncate">{displayNameOf(user, user.id)}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                @{user.username ?? user.id}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <UploadButton
          channelId={channelId}
          onAttached={(attachment) =>
            setAttachments((current) =>
              current.some((item) => item.fileId === attachment.fileId)
                ? current
                : [...current, attachment],
            )
          }
        />
        <div className="relative">
          <button
            type="button"
            aria-label={t("messages.emoji")}
            title={t("messages.emoji")}
            className="shrink-0 rounded px-2 py-2 text-sm text-muted-foreground hover:bg-accent"
            onClick={() => setEmojiOpen((open) => !open)}
          >
            😊
          </button>
          {emojiOpen && (
            <>
              <button
                type="button"
                aria-label={t("messages.closeEmoji")}
                className="fixed inset-0 z-10 cursor-default"
                onClick={() => setEmojiOpen(false)}
              />
              <div className="absolute bottom-full left-0 z-20 mb-2 grid w-64 grid-cols-8 gap-1 rounded-md border bg-popover p-2 shadow-md">
                {ALLOWED_EMOJI.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="rounded p-1 text-lg hover:bg-accent"
                    onClick={() => insertEmoji(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          placeholder={t("messages.composerPlaceholder")}
          aria-label={t("messages.composerPlaceholder")}
          className="max-h-40 flex-1 resize-none rounded border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          onChange={(event) => {
            setText(event.target.value);
            if (failed) {
              setFailed(false);
            }
            syncMention(
              event.target.value,
              event.target.selectionStart ?? event.target.value.length,
            );
            const now = Date.now();
            if (now - lastTypingSent.current > 3000) {
              lastTypingSent.current = now;
              wsClient.send({ type: "typing", channelId });
            }
          }}
          onPaste={(event) => {
            const files = [...event.clipboardData.files];
            if (files.length > 0) {
              event.preventDefault();
              void addFiles(files);
            }
          }}
          onKeyDown={(event) => {
            if (mention && mentionList.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setMention((current) =>
                  current ? { ...current, index: (current.index + 1) % mentionList.length } : null,
                );
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setMention((current) =>
                  current
                    ? {
                        ...current,
                        index: (current.index - 1 + mentionList.length) % mentionList.length,
                      }
                    : null,
                );
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                const picked = mentionList[mention.index] ?? mentionList[0];
                if (picked) {
                  selectMention(picked);
                }
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setMention(null);
                return;
              }
            }
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
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
