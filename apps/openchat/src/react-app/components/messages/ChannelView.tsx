import { useQuery } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { appClient } from "@/app-client";
import { api } from "@/lib/api";
import { wsClient } from "@/ws/client";
import { useMessageStore } from "@/stores/messages";
import { useSidebarStore } from "@/stores/sidebar";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { TypingIndicator } from "./TypingIndicator";

export function ChannelView({ channelId }: { channelId: string }) {
  const maxSeq = useMessageStore((s) => s.maxSeq(channelId));

  useQuery({
    queryKey: ["history", channelId],
    queryFn: async () => {
      const res = await api.posts.list(channelId, { limit: 30 });
      await appClient.channels.applyHistory(channelId, res.messages);
      return res;
    },
  });

  useEffect(() => {
    void appClient.channels.hydrate(channelId);
  }, [channelId]);

  useEffect(() => {
    if (maxSeq > 0) {
      useSidebarStore.getState().markRead(channelId);
      wsClient.send({ type: "mark_read", channelId, seq: maxSeq });
    }
  }, [channelId, maxSeq]);

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <MessageList channelId={channelId} />
        <TypingIndicator channelId={channelId} />
        <Composer channelId={channelId} />
      </div>
      <Outlet />
    </div>
  );
}
