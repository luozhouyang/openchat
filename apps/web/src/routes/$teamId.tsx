import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../lib/api";
import { wsClient } from "../ws/client";
import { useSidebarStore } from "../stores/sidebar";
import { TeamRail } from "../components/workspace/TeamRail";
import { Sidebar } from "../components/workspace/Sidebar";

export const Route = createFileRoute("/$teamId")({
  component: WorkspaceLayout,
  loader: async () => {
    const workspaces = await api.workspaces();
    if (workspaces.teams.length === 0) throw redirect({ to: "/login" });
    return workspaces;
  },
});

function WorkspaceLayout() {
  const { teamId } = Route.useParams();
  const data = Route.useLoaderData();
  const team = data.teams.find((t) => t.id === teamId);

  const sidebar = useQuery({ queryKey: ["sidebar"], queryFn: api.sidebar });
  useEffect(() => {
    if (sidebar.data) useSidebarStore.getState().loadAll(sidebar.data.channels);
  }, [sidebar.data]);

  useEffect(() => {
    const deviceId = localStorage.getItem("deviceId") ?? crypto.randomUUID();
    localStorage.setItem("deviceId", deviceId);
    void wsClient.connect(deviceId);
    return () => wsClient.close();
  }, []);

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
