import { useEffect, useState } from "react";
import { Link, useMatchRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { ChannelSummary } from "protocol";
import { useSidebarStore } from "@/stores/sidebar";
import { useMe } from "@/hooks/use-me";
import { usePresenceStore, useStatus } from "@/stores/presence";
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
import { StatusDot } from "@/components/presence/StatusDot";
import {
  CompassIcon,
  HashIcon,
  MessageCircleIcon,
  MessagesSquareIcon,
  PlusIcon,
} from "lucide-react";
import { BrowseChannelsDialog } from "./BrowseChannelsDialog";
import { ThreadsDialog } from "./ThreadsDialog";
import { NewChannelDialog } from "./NewChannelDialog";
import { NewDmDialog } from "./NewDmDialog";

/** Refresh direct-message presence while the sidebar is mounted. */
const PRESENCE_REFRESH_MS = 45_000;

function unreadBadge(unread: number, mentions: number) {
  if (mentions > 0) {
    return { label: `@${mentions}`, className: "bg-destructive text-destructive-foreground" };
  }
  if (unread > 0) {
    return { label: String(unread), className: "" };
  }
  return null;
}

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
  const me = useMe();
  const entries = useSidebarStore((s) => s.entries);
  const match = useMatchRoute();
  const [channelOpen, setChannelOpen] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);

  const partnerIds = directs
    .map((direct) => direct.memberIds?.find((id) => id !== me?.id))
    .filter((id): id is string => typeof id === "string");
  const partnerKey = partnerIds.join(",");

  useEffect(() => {
    if (partnerIds.length === 0) {
      return;
    }
    usePresenceStore.getState().ensure(partnerIds);
    const timer = setInterval(() => {
      usePresenceStore.getState().ensure(partnerIds);
    }, PRESENCE_REFRESH_MS);
    return () => clearInterval(timer);
    // partnerIds is derived from the workspace payload; key by contents.
  }, [partnerKey]);

  return (
    <SidebarContent>
      {teamId && (
        <SidebarGroup>
          <SidebarGroupLabel>{t("workspace.channels")}</SidebarGroupLabel>
          <SidebarGroupAction
            aria-label={t("workspace.newChannel")}
            onClick={() => setChannelOpen(true)}
          >
            <PlusIcon />
          </SidebarGroupAction>
          <SidebarMenu>
            {channels.map((c) => {
              const e = entries[c.id];
              const badge = e ? unreadBadge(e.unread, e.mentions) : null;
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
                  {badge && (
                    <SidebarMenuBadge className={badge.className}>{badge.label}</SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              );
            })}
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setBrowseOpen(true)}
                tooltip={t("workspace.browseChannels")}
              >
                <CompassIcon />
                <span>{t("workspace.browseChannels")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setThreadsOpen(true)}
                tooltip={t("workspace.threads")}
              >
                <MessageCircleIcon />
                <span>{t("workspace.threads")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      )}
      <SidebarGroup>
        <SidebarGroupLabel>{t("workspace.directs")}</SidebarGroupLabel>
        <SidebarGroupAction aria-label={t("workspace.newDm")} onClick={() => setDmOpen(true)}>
          <PlusIcon />
        </SidebarGroupAction>
        <SidebarMenu>
          {directs.map((c) => (
            <DirectMenuItem key={c.id} channel={c} />
          ))}
        </SidebarMenu>
      </SidebarGroup>
      {channelOpen && <NewChannelDialog teamId={teamId!} open onOpenChange={setChannelOpen} />}
      {browseOpen && teamId && (
        <BrowseChannelsDialog teamId={teamId} open onOpenChange={setBrowseOpen} />
      )}
      {threadsOpen && teamId && (
        <ThreadsDialog teamId={teamId} open onOpenChange={setThreadsOpen} />
      )}
      {dmOpen && <NewDmDialog open onOpenChange={setDmOpen} />}
    </SidebarContent>
  );
}

function DirectMenuItem({ channel }: { channel: ChannelSummary }) {
  const me = useMe();
  const match = useMatchRoute();
  const entry = useSidebarStore((s) => s.entries[channel.id]);
  const partnerId = channel.memberIds?.find((id) => id !== me?.id);
  const status = useStatus(partnerId);
  const badge = entry ? unreadBadge(entry.unread, entry.mentions) : null;
  const active = !!match({ to: "/dm/$channelId", params: { channelId: channel.id } });

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link to="/dm/$channelId" params={{ channelId: channel.id }} />}
        isActive={active}
        tooltip={channel.displayName}
      >
        <span className="relative inline-flex">
          <MessagesSquareIcon />
          <StatusDot status={status} className="absolute -right-1 -bottom-1 ring-2 ring-sidebar" />
        </span>
        <span>{channel.displayName}</span>
      </SidebarMenuButton>
      {badge && <SidebarMenuBadge className={badge.className}>{badge.label}</SidebarMenuBadge>}
    </SidebarMenuItem>
  );
}
