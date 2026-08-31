import { createFileRoute } from "@tanstack/react-router";
import { MessageList } from "../../components/messages/MessageList";
import { Composer } from "../../components/messages/Composer";
import { ThreadPanel } from "../../components/messages/ThreadPanel";

export const Route = createFileRoute("/$teamId/c/$channelId/t/$threadId")({
  component: ThreadView,
});

function ThreadView() {
  const { channelId, threadId } = Route.useParams();
  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <MessageList channelId={channelId} />
        <Composer channelId={channelId} />
      </div>
      <aside className="flex w-96 flex-col border-l">
        <ThreadPanel channelId={channelId} parentId={threadId} />
      </aside>
    </div>
  );
}
