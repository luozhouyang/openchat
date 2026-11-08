import { useRef, useState } from "react";
import { Link, useLocation, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { id } from "protocol";
import { PinIcon } from "lucide-react";
import { wsClient } from "@/ws/client";
import { api } from "@/lib/api";
import { useMe } from "@/hooks/use-me";
import { useMessageStore } from "@/stores/messages";
import { displayNameOf, initialsOf, useUser } from "@/stores/users";
import { MentionText } from "./MentionText";
import { ReactionBar } from "./ReactionBar";
import { AttachmentView } from "@/components/upload/AttachmentView";
import type { StoreMessage } from "@/stores/messages";

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

interface MessageRowProps {
  message: StoreMessage;
  channelId: string;
  /** Same author within the grouping window: hide avatar and header. */
  compact?: boolean;
  /** Inside a thread panel: no "reply in thread" action. */
  inThread?: boolean;
  /** Transient highlight after jumping from search. */
  highlight?: boolean;
}

export function MessageRow({
  message,
  channelId,
  compact = false,
  inThread = false,
  highlight = false,
}: MessageRowProps) {
  const { t } = useTranslation();
  const me = useMe();
  const { teamId } = useParams({ strict: false }) as { teamId?: string };
  const inDirectMessages = useLocation().pathname.startsWith("/dm/");
  const author = useUser(message.userId);
  const name = displayNameOf(author, message.userId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const editRef = useRef<HTMLTextAreaElement>(null);

  if (message.deletedAt) {
    return (
      <div className="px-4 py-1 text-sm italic text-muted-foreground">{t("messages.deleted")}</div>
    );
  }

  const pending = message.seq === 0;
  const mine = me?.id === message.userId;
  const edited = message.editedAt !== null && message.editedAt !== undefined;
  const time = timeFormatter.format(new Date(message.createdAt));
  const fullDate = fullDateFormatter.format(new Date(message.createdAt));

  async function submitEdit() {
    const content = draft.trim();
    setEditing(false);
    if (!content || content === message.content) {
      setDraft(message.content);
      return;
    }
    try {
      await api.posts.patch(message.id, { message: content, channelId });
    } catch {
      setDraft(message.content);
    }
  }

  async function remove() {
    if (!window.confirm(t("messages.deleteConfirm"))) {
      return;
    }
    try {
      await api.posts.remove(message.id, { channelId });
    } catch {
      // The row stays; the server is the source of truth for deletion.
    }
  }

  function startEdit() {
    setDraft(message.content);
    setEditing(true);
    requestAnimationFrame(() => editRef.current?.focus());
  }

  async function togglePin() {
    try {
      if (message.isPinned) {
        await api.posts.unpin(channelId, message.id);
      } else {
        await api.posts.pin(channelId, message.id);
      }
      useMessageStore.getState().setPinned(channelId, message.id, !message.isPinned);
    } catch {
      // Pin rights are enforced server-side; a rejected call leaves the row.
    }
  }

  function toggleReaction() {
    wsClient.send({
      type: "react",
      channelId,
      messageSeq: message.seq,
      emoji: "👍",
      clientToken: id("int"),
    });
  }

  const actions = (
    <div className="absolute -top-3 right-4 hidden items-center gap-1 rounded-md border bg-background px-1 py-0.5 shadow-sm group-hover:flex group-focus-within:flex">
      {!inThread && inDirectMessages && (
        <Link
          to="/dm/$channelId/t/$threadId"
          params={{ channelId, threadId: message.id }}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {t("messages.reply")}
        </Link>
      )}
      {!inThread && !inDirectMessages && teamId && (
        <Link
          to="/$teamId/c/$channelId/t/$threadId"
          params={{ teamId, channelId, threadId: message.id }}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {t("messages.reply")}
        </Link>
      )}
      <button
        type="button"
        onClick={toggleReaction}
        aria-label={t("messages.react")}
        title={t("messages.react")}
        className="rounded px-2 py-1 text-xs hover:bg-accent"
      >
        👍
      </button>
      {!pending && (
        <button
          type="button"
          onClick={() => void togglePin()}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {message.isPinned ? t("messages.unpin") : t("messages.pin")}
        </button>
      )}
      {!pending && mine && (
        <>
          <button
            type="button"
            onClick={startEdit}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {t("messages.edit")}
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-destructive"
          >
            {t("messages.delete")}
          </button>
        </>
      )}
    </div>
  );

  const body = editing ? (
    <div className="mt-1 flex flex-col gap-1">
      <textarea
        ref={editRef}
        className="w-full resize-none rounded border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submitEdit();
          } else if (e.key === "Escape") {
            setEditing(false);
            setDraft(message.content);
          }
        }}
      />
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          onClick={() => void submitEdit()}
          className="rounded bg-primary px-2 py-1 text-primary-foreground"
        >
          {t("messages.save")}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setDraft(message.content);
          }}
          className="rounded border px-2 py-1"
        >
          {t("messages.cancel")}
        </button>
      </div>
    </div>
  ) : (
    <MentionText content={message.content} className="whitespace-pre-wrap break-words text-sm" />
  );

  return (
    <div
      className={`group relative flex gap-3 px-4 hover:bg-accent/40 focus-within:bg-accent/40 ${
        compact ? "py-0.5" : "py-1.5"
      } ${pending ? "opacity-60" : ""} ${highlight ? "bg-primary/10 ring-2 ring-primary/30" : ""}`}
    >
      <div className="w-9 shrink-0 pt-0.5">
        {compact ? (
          <time
            dateTime={new Date(message.createdAt).toISOString()}
            title={fullDate}
            className="hidden text-right text-[10px] leading-5 text-muted-foreground group-hover:block group-focus-within:block"
          >
            {time}
          </time>
        ) : (
          <Avatar name={name} url={author?.avatarUrl} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">{name}</span>
            <time
              dateTime={new Date(message.createdAt).toISOString()}
              title={fullDate}
              className="text-xs text-muted-foreground"
            >
              {time}
            </time>
            {edited && (
              <span className="text-xs text-muted-foreground">{t("messages.edited")}</span>
            )}
            {message.isPinned && (
              <PinIcon className="size-3 text-muted-foreground" aria-label={t("messages.pinned")} />
            )}
          </div>
        )}
        {body}
        {message.attachments && message.attachments.length > 0 && (
          <AttachmentView message={message} />
        )}
        {message.reactions && Object.keys(message.reactions).length > 0 && (
          <ReactionBar
            channelId={channelId}
            messageSeq={message.seq}
            reactions={message.reactions}
          />
        )}
      </div>
      {!pending && actions}
    </div>
  );
}

function Avatar({ name, url }: { name: string; url?: string | null }) {
  if (url) {
    return (
      <img src={url} alt="" loading="lazy" className="size-9 rounded-full bg-muted object-cover" />
    );
  }
  return (
    <div className="grid size-9 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
      {initialsOf(name)}
    </div>
  );
}
