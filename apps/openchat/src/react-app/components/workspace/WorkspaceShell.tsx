import { Outlet } from "@tanstack/react-router";
import type { ChannelSummary } from "protocol";
import { useTranslation } from "react-i18next";
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
          <header className="flex h-12 items-center gap-2 border-b px-4">
            <SidebarTrigger aria-label={t("workspace.directs")} />
            <span className="font-semibold">{title}</span>
          </header>
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
