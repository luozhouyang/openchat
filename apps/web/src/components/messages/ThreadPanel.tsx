import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../lib/api";
import { useMessageStore } from "../../stores/messages";
import { wsClient } from "../../ws/client";
import type { ClientFrame } from "protocol";

export function ThreadPanel({ channelId, parentId }: { channelId: string; parentId: string }) {
  // threadList() derives a fresh array; shallow-compare to keep snapshots stable.
  const messages = useMessageStore(useShallow((s) => s.threadList(channelId, parentId)));

  useQuery({
    queryKey: ["thread", parentId],
    queryFn: async () => {
      const res = await api.posts.list(channelId, { parentId, order: "asc", limit: 100 });
      for (const m of res.messages) useMessageStore.getState().ingestThread(channelId, m);
      return res;
    },
  });

  useEffect(() => {
    wsClient.send({ type: "subscribe_thread", channelId, parentId, subscribe: true });
    return () => wsClient.send({ type: "subscribe_thread", channelId, parentId, subscribe: false });
  }, [channelId, parentId]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-2 text-sm font-semibold">线程</div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.map((m) => (
          <div key={m.id} className="text-sm">
            <span className="font-semibold">{m.userId}</span> {m.content}
          </div>
        ))}
      </div>
      <ThreadComposer channelId={channelId} parentId={parentId} />
    </div>
  );
}

function ThreadComposer({ channelId, parentId }: { channelId: string; parentId: string }) {
  const [text, setText] = useState("");

  function send() {
    const content = text.trim();
    if (!content) return;
    const clientToken = crypto.randomUUID();
    wsClient.send({
      type: "post_message",
      channelId,
      content,
      parentId,
      clientToken,
    } as unknown as ClientFrame);
    setText("");
  }

  return (
    <div className="border-t p-3">
      <input
        className="w-full rounded border px-3 py-2 text-sm"
        value={text}
        placeholder="回复线程…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
    </div>
  );
}
