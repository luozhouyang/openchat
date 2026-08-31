import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiFetch } from "../../lib/api";
import { wsClient } from "../../ws/client";
import { useMessageStore } from "../../stores/messages";
import { useSidebarStore } from "../../stores/sidebar";
import { MessageList } from "../../components/messages/MessageList";
import { Composer } from "../../components/messages/Composer";
import { TypingIndicator } from "../../components/messages/TypingIndicator";
import type { Message } from "protocol";

export const Route = createFileRoute("/$teamId/c/$channelId")({
  component: ChannelView,
});

function ChannelView() {
  const { channelId } = Route.useParams();
  const maxSeq = useMessageStore((s) => s.maxSeq(channelId));

  useQuery({
    queryKey: ["history", channelId],
    queryFn: async () => {
      const res = await apiFetch<{ messages: Message[] }>(
        `/api/channels/${channelId}/history?limit=30`,
      );
      useMessageStore.getState().applySync(channelId, res.messages);
      return res;
    },
  });

  useEffect(() => {
    if (maxSeq > 0) {
      useSidebarStore.getState().markRead(channelId);
      wsClient.send({ type: "mark_read", channelId, seq: maxSeq });
    }
  }, [channelId, maxSeq]);

  useEffect(() => {
    const off = wsClient.onLocal((ev) => {
      if (ev.type === "sync.result" && ev.channelId === channelId) {
        useMessageStore.getState().applySync(ev.channelId, ev.messages);
      }
    });
    return () => {
      off();
    };
  }, [channelId]);

  return (
    <div className="flex h-full flex-col">
      <MessageList channelId={channelId} />
      <TypingIndicator channelId={channelId} />
      <Composer channelId={channelId} />
    </div>
  );
}
