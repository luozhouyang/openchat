import { createFileRoute } from "@tanstack/react-router";
import { ThreadPanel } from "@/components/messages/ThreadPanel";

export const Route = createFileRoute("/dm/$channelId/t/$threadId")({
  component: DmThreadView,
});

function DmThreadView() {
  const { channelId, threadId } = Route.useParams();
  return (
    <aside className="flex w-96 flex-col border-l">
      <ThreadPanel channelId={channelId} parentId={threadId} />
    </aside>
  );
}
