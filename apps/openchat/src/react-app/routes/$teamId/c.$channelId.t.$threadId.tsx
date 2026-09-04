import { createFileRoute } from "@tanstack/react-router";
import { ThreadPanel } from "@/components/messages/ThreadPanel";

export const Route = createFileRoute("/$teamId/c/$channelId/t/$threadId")({
  component: ThreadView,
});

function ThreadView() {
  const { channelId, threadId } = Route.useParams();
  return (
    <aside className="flex w-96 flex-col border-l">
      <ThreadPanel channelId={channelId} parentId={threadId} />
    </aside>
  );
}
