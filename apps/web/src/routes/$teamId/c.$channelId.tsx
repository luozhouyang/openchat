import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/$teamId/c/$channelId")({
  component: () => <div className="p-8 text-zinc-500">频道</div>,
});
