import { createFileRoute } from "@tanstack/react-router";
import { ChannelView } from "@/components/messages/ChannelView";

export const Route = createFileRoute("/dm/$channelId")({
  component: DmChannelView,
});

function DmChannelView() {
  const { channelId } = Route.useParams();
  return <ChannelView channelId={channelId} />;
}
