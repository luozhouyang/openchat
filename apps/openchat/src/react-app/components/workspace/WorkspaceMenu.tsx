import { useState } from "react";
import { Link, useMatchRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { ChannelSummary } from "protocol";
import { useSidebarStore } from "@/stores/sidebar";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { HashIcon, MessagesSquareIcon, PlusIcon } from "lucide-react";
import { NewChannelDialog } from "./NewChannelDialog";

export function WorkspaceMenu({
  teamId,
  channels,
  directs,
}: {
  teamId: string | null;
  channels: ChannelSummary[];
  directs: ChannelSummary[];
}) {
  const { t } = useTranslation();
  const entries = useSidebarStore((s) => s.entries);
  const match = useMatchRoute();
  const [channelOpen, setChannelOpen] = useState(false);
  return (
    <SidebarContent>
      {teamId && (
        <SidebarGroup className="group/section">
          <SidebarGroupLabel>{t("workspace.channels")}</SidebarGroupLabel>
          <SidebarGroupAction
            aria-label={t("workspace.newChannel")}
            onClick={() => setChannelOpen(true)}
            className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover/section:opacity-100 group-focus-within/section:opacity-100"
          >
            <PlusIcon />
          </SidebarGroupAction>
          <SidebarMenu>
            {channels.map((c) => {
              const e = entries[c.id];
              const active = !!match({
                to: "/$teamId/c/$channelId",
                params: { teamId, channelId: c.id },
              });
              return (
                <SidebarMenuItem key={c.id}>
                  <SidebarMenuButton
                    render={
                      <Link to="/$teamId/c/$channelId" params={{ teamId, channelId: c.id }} />
                    }
                    isActive={active}
                    tooltip={c.displayName}
                  >
                    <HashIcon />
                    <span aria-hidden># </span>
                    <span>{c.displayName}</span>
                  </SidebarMenuButton>
                  {e && (e.unread > 0 || e.mentions > 0) && (
                    <SidebarMenuBadge
                      className={e.mentions > 0 ? "bg-destructive text-destructive-foreground" : ""}
                    >
                      {e.mentions > 0 ? `@${e.mentions}` : e.unread}
                    </SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      )}
      <SidebarGroup>
        <SidebarGroupLabel>{t("workspace.directs")}</SidebarGroupLabel>
        <SidebarMenu>
          {directs.map((c) => {
            const active = !!match({ to: "/dm/$channelId", params: { channelId: c.id } });
            return (
              <SidebarMenuItem key={c.id}>
                <SidebarMenuButton
                  render={<Link to="/dm/$channelId" params={{ channelId: c.id }} />}
                  isActive={active}
                  tooltip={c.displayName}
                >
                  <MessagesSquareIcon />
                  <span>{c.displayName}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroup>
      {channelOpen && <NewChannelDialog teamId={teamId!} open onOpenChange={setChannelOpen} />}
    </SidebarContent>
  );
}
