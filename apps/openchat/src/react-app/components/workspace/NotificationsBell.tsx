import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { NotificationItem } from "protocol";
import { api } from "@/lib/api";
import { BellIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MentionText } from "@/components/messages/MentionText";

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function NotificationsBell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.notifications.list(50),
    refetchInterval: 60_000,
  });
  const unread = data?.unread ?? 0;
  const items = data?.notifications ?? [];

  async function markAll() {
    try {
      await api.notifications.markRead();
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    } catch {
      // The badge refreshes on the next poll anyway.
    }
  }

  async function openItem(item: NotificationItem) {
    setOpen(false);
    try {
      if (item.readAt === null) {
        await api.notifications.markRead([item.id]);
        await queryClient.invalidateQueries({ queryKey: ["notifications"] });
      }
      // Hand the jump target to the message list through session storage so
      // it survives the route change.
      sessionStorage.setItem(`openchat:jump:${item.channelId}`, String(item.seq));
      const detail = await api.channels.get(item.channelId);
      if (detail.channel.teamId) {
        await navigate({
          to: "/$teamId/c/$channelId",
          params: { teamId: detail.channel.teamId, channelId: item.channelId },
        });
      } else {
        await navigate({ to: "/dm/$channelId", params: { channelId: item.channelId } });
      }
    } catch {
      // Keep the dialog closed; the next attempt can retry the navigation.
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={t("notifications.title")}
        title={t("notifications.title")}
        className="relative rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        <BellIcon className="size-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("notifications.title")}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {t("notifications.unread", { count: unread })}
            </span>
            <button
              type="button"
              className="rounded px-2 py-1 hover:bg-accent"
              onClick={() => void markAll()}
            >
              {t("notifications.markAllRead")}
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">{t("notifications.empty")}</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void openItem(item)}
                  className={`block w-full border-b py-2 text-left last:border-b-0 hover:bg-accent ${
                    item.readAt === null ? "bg-primary/5" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {t(`notifications.${item.kind}`)}
                    </span>
                    <time dateTime={new Date(item.createdAt).toISOString()}>
                      {timeFormatter.format(new Date(item.createdAt))}
                    </time>
                  </div>
                  <MentionText
                    content={item.preview}
                    className="line-clamp-2 whitespace-pre-wrap break-words text-sm"
                  />
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
