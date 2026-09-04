import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useSidebarStore, useStructureStore } from "state";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

export const Route = createFileRoute("/$teamId")({
  component: WorkspaceLayout,
  loader: async () => {
    const workspaces = await api.workspaces();
    if (workspaces.teams.length === 0) throw redirect({ to: "/dm" });
    return workspaces;
  },
});

function WorkspaceLayout() {
  const { teamId } = Route.useParams();
  const data = Route.useLoaderData();
  const team = data.teams.find((t) => t.id === teamId);
  const router = useRouter();
  const queryClient = useQueryClient();
  const structureVersion = useStructureStore((s) => s.version);
  const lastVersion = useRef(0);

  const sidebar = useQuery({ queryKey: ["sidebar"], queryFn: api.sidebar, staleTime: 30_000 });
  useEffect(() => {
    if (sidebar.data) useSidebarStore.getState().loadAll(sidebar.data.channels);
  }, [sidebar.data]);

  useEffect(() => {
    if (structureVersion === 0 || structureVersion === lastVersion.current) return;
    lastVersion.current = structureVersion;
    void router.invalidate();
    void queryClient.invalidateQueries({ queryKey: ["sidebar"] });
  }, [structureVersion]);

  if (!team) return <div className="p-8">团队不存在</div>;

  return (
    <WorkspaceShell
      teams={data.teams}
      currentTeamId={teamId}
      title={team.displayName}
      channels={team.channels.filter((c) => c.member)}
      directs={data.directs}
    />
  );
}
