import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { useSidebarStore } from "@/stores/sidebar";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

export const Route = createFileRoute("/dm")({
  component: DmLayout,
  loader: async () => {
    return api.workspaces().catch(() => ({ teams: [], directs: [] }));
  },
});

function DmLayout() {
  const data = Route.useLoaderData();
  const sidebar = useQuery({ queryKey: ["sidebar"], queryFn: api.sidebar });
  useEffect(() => {
    if (sidebar.data) useSidebarStore.getState().loadAll(sidebar.data.channels);
  }, [sidebar.data]);

  return (
    <WorkspaceShell
      teams={data.teams}
      currentTeamId={null}
      title="私信"
      channels={[]}
      directs={data.directs}
    />
  );
}
