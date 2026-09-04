import { createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "@/lib/api";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const workspaces = await api.workspaces();
    if (workspaces.teams.length > 0) {
      throw redirect({ to: "/$teamId", params: { teamId: workspaces.teams[0].id } });
    }
    throw redirect({ to: "/dm" });
  },
});
