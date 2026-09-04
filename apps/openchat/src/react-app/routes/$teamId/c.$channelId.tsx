import { createFileRoute } from "@tanstack/react-router";
import { ChannelView } from "@/components/messages/ChannelView";

export const Route = createFileRoute("/$teamId/c/$channelId")({
  component: ChannelRoute,
});

function ChannelRoute() {
  const { channelId } = Route.useParams();
  return <ChannelView channelId={channelId} />;
}
