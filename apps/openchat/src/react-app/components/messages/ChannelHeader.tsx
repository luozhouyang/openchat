import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  BellIcon,
  BellOffIcon,
  CheckIcon,
  HashIcon,
  LockIcon,
  MessagesSquareIcon,
  PinIcon,
  SearchIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react";
import { useTeamsStore } from "state";
import { api } from "@/lib/api";
import { ChannelSettingsDialog } from "./ChannelSettingsDialog";

const NOTIFY_OPTIONS = ["all", "mention", "none"] as const;

export function ChannelHeader({
  channelId,
  onOpenMembers,
  onOpenPinned,
  onOpenSearch,
}: {
  channelId: string;
  onOpenMembers: () => void;
  onOpenPinned: () => void;
  onOpenSearch: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["channel", channelId],
    queryFn: () => api.channels.get(channelId),
    staleTime: 30_000,
  });
  const channel = data?.channel;
  const isDirect = channel?.type === "dm" || channel?.type === "gm";
  // Direct/group names are personalized in the workspace payload (the channel
  // row only stores a generic display name).
  const { data: notify } = useQuery({
    queryKey: ["notify", channelId],
    queryFn: () => api.channels.getNotifyProps(channelId),
    staleTime: 60_000,
  });
  const pref = notify?.notifyProps.pref ?? "all";
  const direct = useTeamsStore((s) => s.directs.find((entry) => entry.id === channelId));
  const title = isDirect
    ? (direct?.displayName ?? channel?.displayName ?? "")
    : (channel?.displayName ?? "");

  async function setPref(next: (typeof NOTIFY_OPTIONS)[number]) {
    try {
      await api.channels.setNotifyProps(channelId, { notifyProps: { pref: next } });
      queryClient.setQueryData(["notify", channelId], { notifyProps: { pref: next } });
    } catch {
      // The current pref stays when the write is rejected.
    }
    setNotifyOpen(false);
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      {isDirect ? (
        <MessagesSquareIcon className="size-4 shrink-0 text-muted-foreground" />
      ) : channel?.type === "private" ? (
        <LockIcon className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <HashIcon className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate font-semibold">{title}</span>
      {channel?.purpose && (
        <span className="hidden truncate text-xs text-muted-foreground md:inline">
          {channel.purpose}
        </span>
      )}
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          aria-label={t("channel.settings")}
          title={t("channel.settings")}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => setSettingsOpen(true)}
        >
          <SettingsIcon className="size-4" />
        </button>
        <div className="relative">
          <button
            type="button"
            aria-label={t("channel.notifications")}
            title={t("channel.notifications")}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setNotifyOpen((open) => !open)}
          >
            {pref === "none" ? <BellOffIcon className="size-4" /> : <BellIcon className="size-4" />}
          </button>
          {notifyOpen && (
            <>
              <button
                type="button"
                aria-label={t("messages.closeEmoji")}
                className="fixed inset-0 z-10 cursor-default"
                onClick={() => setNotifyOpen(false)}
              />
              <div className="absolute top-full right-0 z-20 mt-1 w-48 overflow-hidden rounded-md border bg-popover p-1 shadow-md">
                {NOTIFY_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() => void setPref(option)}
                  >
                    <span className="flex-1">{t(`channel.notify_${option}`)}</span>
                    {pref === option && <CheckIcon className="size-3.5" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          aria-label={t("channel.search")}
          title={t("channel.search")}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onOpenSearch}
        >
          <SearchIcon className="size-4" />
        </button>
        <button
          type="button"
          aria-label={t("channel.pinned")}
          title={t("channel.pinned")}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onOpenPinned}
        >
          <PinIcon className="size-4" />
        </button>
        <button
          type="button"
          aria-label={t("channel.members")}
          title={t("channel.members")}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onOpenMembers}
        >
          <UsersIcon className="size-4" />
          {channel?.memberCount ?? 0}
        </button>
      </div>
      <ChannelSettingsDialog
        channelId={channelId}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initial={channel}
      />
    </header>
  );
}
