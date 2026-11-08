import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  HashIcon,
  LockIcon,
  MessagesSquareIcon,
  PinIcon,
  SearchIcon,
  UsersIcon,
} from "lucide-react";
import { useTeamsStore } from "state";
import { api } from "@/lib/api";

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
  const { data } = useQuery({
    queryKey: ["channel", channelId],
    queryFn: () => api.channels.get(channelId),
    staleTime: 30_000,
  });
  const channel = data?.channel;
  const isDirect = channel?.type === "dm" || channel?.type === "gm";
  // Direct/group names are personalized in the workspace payload (the channel
  // row only stores a generic display name).
  const direct = useTeamsStore((s) => s.directs.find((entry) => entry.id === channelId));
  const title = isDirect
    ? (direct?.displayName ?? channel?.displayName ?? "")
    : (channel?.displayName ?? "");

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
    </header>
  );
}
