import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { api } from "@/lib/api";
import { useMessageStore } from "@/stores/messages";
import { wsClient } from "@/ws/client";
import { MessageRow } from "./MessageRow";

export function ThreadPanel({ channelId, parentId }: { channelId: string; parentId: string }) {
  const { t } = useTranslation();
  // threadList() derives a fresh array; shallow-compare to keep snapshots stable.
  const messages = useMessageStore(useShallow((s) => s.threadList(channelId, parentId)));

  useQuery({
    queryKey: ["thread", parentId],
    queryFn: async () => {
      const res = await api.posts.list(channelId, { parentId, order: "asc", limit: 100 });
      for (const m of res.messages) {
        useMessageStore.getState().ingestThread(channelId, m);
      }
      return res;
    },
  });

  useEffect(() => {
    wsClient.send({ type: "subscribe_thread", channelId, parentId, subscribe: true });
    return () => wsClient.send({ type: "subscribe_thread", channelId, parentId, subscribe: false });
  }, [channelId, parentId]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-2 text-sm font-semibold">{t("messages.threadTitle")}</div>
      <div className="flex-1 overflow-y-auto py-2">
        {messages.length === 0 ? (
          <div className="px-4 text-sm text-muted-foreground">{t("messages.emptyThread")}</div>
        ) : (
          messages.map((message) => (
            <MessageRow key={message.id} message={message} channelId={channelId} inThread />
          ))
        )}
      </div>
      <ThreadComposer channelId={channelId} parentId={parentId} />
    </div>
  );
}

function ThreadComposer({ channelId, parentId }: { channelId: string; parentId: string }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function send() {
    const content = text.trim();
    if (!content || sending) {
      return;
    }
    setSending(true);
    setFailed(false);
    setText("");
    try {
      // Thread replies go through the REST write path; the old `post_message`
      // WS frame was removed with P11 and silently dropped by parseClientFrame.
      const posted = await api.posts.create(channelId, {
        message: content,
        parentId,
        clientToken: crypto.randomUUID(),
      });
      useMessageStore.getState().ingestThread(channelId, posted);
    } catch {
      setText(content);
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border-t p-3">
      {failed && (
        <div role="alert" className="mb-2 text-xs text-destructive">
          {t("messages.sendFailed")}
        </div>
      )}
      <input
        className="w-full rounded border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        value={text}
        placeholder={t("messages.threadPlaceholder")}
        aria-label={t("messages.threadPlaceholder")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
      />
    </div>
  );
}
