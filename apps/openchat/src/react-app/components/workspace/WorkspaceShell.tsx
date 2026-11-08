import { Outlet } from "@tanstack/react-router";
import type { ChannelSummary } from "protocol";
import { useTranslation } from "react-i18next";
import { useConnectionStore } from "state";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Sidebar,
  SidebarFooter,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { NotificationsBell } from "./NotificationsBell";
import { TeamSwitcher } from "./TeamSwitcher";
import { UserMenu } from "./UserMenu";
import { WorkspaceMenu } from "./WorkspaceMenu";

interface WorkspaceShellProps {
  teams: Array<{ id: string; displayName: string }>;
  currentTeamId: string | null;
  title: string;
  channels: ChannelSummary[];
  directs: ChannelSummary[];
}

export function WorkspaceShell({
  teams,
  currentTeamId,
  title,
  channels,
  directs,
}: WorkspaceShellProps) {
  const { t } = useTranslation();
  return (
    <TooltipProvider delay={0}>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <TeamSwitcher teams={teams} currentTeamId={currentTeamId} />
          <WorkspaceMenu teamId={currentTeamId} channels={channels} directs={directs} />
          <div className="mx-2">
            <SidebarSeparator className="mx-0" />
          </div>
          <SidebarFooter>
            <UserMenu />
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          <ConnectionBanner />
          <header className="flex h-12 items-center gap-2 border-b px-4">
            <SidebarTrigger aria-label={t("workspace.directs")} />
            <span className="font-semibold">{title}</span>
            <div className="ml-auto">
              <NotificationsBell />
            </div>
          </header>
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

function ConnectionBanner() {
  const { t } = useTranslation();
  const state = useConnectionStore((s) => s.state);
  if (state === "open" || state === "idle") {
    return null;
  }
  const reconnecting = state === "connecting" || state === "reconnecting";
  return (
    <div
      role="status"
      className={`px-4 py-1 text-center text-xs ${
        reconnecting ? "bg-amber-100 text-amber-900" : "bg-destructive/10 text-destructive"
      }`}
    >
      {reconnecting ? t("workspace.reconnecting") : t("workspace.disconnected")}
    </div>
  );
}
