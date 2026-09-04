import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useTeamsStore } from "state";
import { api } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";

export function TeamSwitcher({
  teams,
  currentTeamId,
}: {
  teams: Array<{ id: string; displayName: string }>;
  currentTeamId: string | null;
}) {
  const { t } = useTranslation();
  const permissions = usePermissions();
  const canCreate = permissions.includes("create_team");
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = teams.find((tm) => tm.id === currentTeamId);

  async function leaveTeam() {
    if (!currentTeamId) return;
    setError(null);
    try {
      await api.teams.leave(currentTeamId);
      useTeamsStore.getState().dropTeam(currentTeamId);
      setOpen(false);
      await navigate({ to: "/dm" });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("workspace.leaveFailed"));
    }
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
              >
                <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
                  {current ? current.displayName.slice(0, 2) : "OC"}
                </div>
                <span>{current ? current.displayName : t("workspace.directs")}</span>
                <ChevronsUpDownIcon className="ml-auto" />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent align="start" side="right" className="w-(--sidebar-width)">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {t("teams.title")}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            {teams.map((tm) => (
              <DropdownMenuItem
                key={tm.id}
                onClick={() => {
                  setOpen(false);
                  void navigate({ to: "/$teamId", params: { teamId: tm.id } });
                }}
              >
                <div className="grid size-6 place-items-center rounded bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
                  {tm.displayName.slice(0, 2)}
                </div>
                <span className="truncate">{tm.displayName}</span>
                {tm.id === currentTeamId && <CheckIcon className="ml-auto" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {canCreate && (
              <DropdownMenuItem
                onClick={() => {
                  setOpen(false);
                  void navigate({ to: "/teams/new" });
                }}
              >
                {t("workspace.createTeam")}
              </DropdownMenuItem>
            )}
            {currentTeamId && (
              <DropdownMenuItem
                onClick={() => {
                  setOpen(false);
                  void navigate({ to: "/$teamId/settings", params: { teamId: currentTeamId } });
                }}
              >
                {t("workspace.teamSettings")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => {
                setOpen(false);
                void navigate({ to: "/teams/new" });
              }}
            >
              {t("workspace.joinTeam")}
            </DropdownMenuItem>
            {currentTeamId && (
              <>
                <DropdownMenuSeparator />
                {error && <p className="px-2 py-1 text-xs text-destructive">{error}</p>}
                <DropdownMenuItem className="text-destructive" onClick={() => void leaveTeam()}>
                  {t("workspace.leaveTeam")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
