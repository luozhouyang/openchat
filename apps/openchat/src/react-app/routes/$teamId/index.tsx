import { createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "@/lib/api";

export const Route = createFileRoute("/$teamId/")({
  beforeLoad: async ({ params }) => {
    const workspaces = await api.workspaces();
    const team = workspaces.teams.find((t) => t.id === params.teamId);
    const first = team?.channels.find(
      (c) => c.member && (c.type === "public" || c.type === "private"),
    );
    if (first)
      throw redirect({
        to: "/$teamId/c/$channelId",
        params: { teamId: params.teamId, channelId: first.id },
      });
  },
  component: () => <div className="p-8 text-zinc-500">尚未加入任何频道</div>,
});
