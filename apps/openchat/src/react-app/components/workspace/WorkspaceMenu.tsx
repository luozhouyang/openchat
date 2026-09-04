import { Link, useMatchRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { ChannelSummary } from "protocol";
import { useSidebarStore } from "@/stores/sidebar";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { HashIcon, MessagesSquareIcon } from "lucide-react";

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
  return (
    <SidebarContent>
      {teamId && (
        <SidebarGroup>
          <SidebarGroupLabel>{t("workspace.channels")}</SidebarGroupLabel>
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
    </SidebarContent>
  );
}
