import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useSidebarStore } from "@/stores/sidebar";
import { useTeamsStore } from "state";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

export const Route = createFileRoute("/dm")({
  component: DmLayout,
  loader: async () => {
    const workspaces = await api.workspaces();
    useTeamsStore.getState().loadAll(workspaces);
    return workspaces;
  },
});

function DmLayout() {
  const teams = useTeamsStore((s) => s.teams);
  const directs = useTeamsStore((s) => s.directs);
  const { t } = useTranslation();
  const sidebar = useQuery({ queryKey: ["sidebar"], queryFn: api.sidebar, staleTime: 30_000 });
  useEffect(() => {
    if (sidebar.data) {
      useSidebarStore.getState().loadAll(sidebar.data.channels);
    }
  }, [sidebar.data]);

  return (
    <WorkspaceShell
      teams={teams}
      currentTeamId={null}
      title={t("workspace.directs")}
      channels={[]}
      directs={directs}
    />
  );
}
