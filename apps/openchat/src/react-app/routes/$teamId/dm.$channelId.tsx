import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/$teamId/dm/$channelId")({
  component: () => <div className="p-8 text-zinc-500">私信</div>,
});
