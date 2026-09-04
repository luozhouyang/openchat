import { createFileRoute, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { useSidebarStore, useStructureStore } from "state";
import { TeamRail } from "@/components/workspace/TeamRail";
import { Sidebar } from "@/components/workspace/Sidebar";

export const Route = createFileRoute("/$teamId")({
  component: WorkspaceLayout,
  loader: async () => {
    const workspaces = await api.workspaces();
    if (workspaces.teams.length === 0) throw redirect({ to: "/auth/login" });
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

  const sidebar = useQuery({ queryKey: ["sidebar"], queryFn: api.sidebar });
  useEffect(() => {
    if (sidebar.data) useSidebarStore.getState().loadAll(sidebar.data.channels);
  }, [sidebar.data]);

  // structure.update events (channel/team created or archived, membership
  // changed) arrive over the shared WS pipeline: refresh live instead of
  // waiting for the next navigation.
  useEffect(() => {
    if (structureVersion === 0) return;
    void router.invalidate();
    void queryClient.invalidateQueries({ queryKey: ["sidebar"] });
  }, [structureVersion, router, queryClient]);

  if (!team) return <div className="p-8">团队不存在</div>;

  return (
    <div className="flex h-screen">
      <TeamRail teams={data.teams} currentTeamId={teamId} />
      <Sidebar team={team} />
      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
