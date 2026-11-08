import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { useSidebarStore, useTeamsStore } from "state";
import { useTranslation } from "react-i18next";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

export const Route = createFileRoute("/$teamId")({
  component: WorkspaceLayout,
  loader: async () => {
    const workspaces = await api.workspaces();
    if (workspaces.teams.length === 0) {
      throw redirect({ to: "/dm" });
    }
    useTeamsStore.getState().loadAll(workspaces);
    return workspaces;
  },
});

function WorkspaceLayout() {
  const { t } = useTranslation();
  const { teamId } = Route.useParams();
  const teams = useTeamsStore((s) => s.teams);
  const directs = useTeamsStore((s) => s.directs);
  const team = teams.find((t) => t.id === teamId);

  const sidebar = useQuery({ queryKey: ["sidebar"], queryFn: api.sidebar, staleTime: 30_000 });
  useEffect(() => {
    if (sidebar.data) {
      useSidebarStore.getState().loadAll(sidebar.data.channels);
    }
  }, [sidebar.data]);

  if (!team) {
    return <div className="p-8">{t("workspace.teamNotFound")}</div>;
  }

  return (
    <WorkspaceShell
      teams={teams}
      currentTeamId={teamId}
      title={team.displayName}
      channels={team.channels.filter((c) => c.member)}
      directs={directs}
    />
  );
}
