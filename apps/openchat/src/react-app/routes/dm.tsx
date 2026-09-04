import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useSidebarStore } from "@/stores/sidebar";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

export const Route = createFileRoute("/dm")({
  component: DmLayout,
  loader: async () => {
    return api.workspaces();
  },
});

function DmLayout() {
  const data = Route.useLoaderData();
  const { t } = useTranslation();
  const sidebar = useQuery({ queryKey: ["sidebar"], queryFn: api.sidebar, staleTime: 30_000 });
  useEffect(() => {
    if (sidebar.data) useSidebarStore.getState().loadAll(sidebar.data.channels);
  }, [sidebar.data]);

  return (
    <WorkspaceShell
      teams={data.teams}
      currentTeamId={null}
      title={t("workspace.directs")}
      channels={[]}
      directs={data.directs}
    />
  );
}
