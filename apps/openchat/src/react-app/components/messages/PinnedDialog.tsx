import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useMessageStore } from "@/stores/messages";
import { displayNameOf, useUsersStore } from "@/stores/users";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MentionText } from "./MentionText";

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function PinnedDialog({
  channelId,
  open,
  onOpenChange,
}: {
  channelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const byId = useUsersStore((s) => s.byId);
  const { data } = useQuery({
    queryKey: ["pinned", channelId],
    queryFn: () => api.posts.listPinned(channelId),
    enabled: open,
  });
  const messages = data?.messages ?? [];
  const authorKey = [...new Set(messages.map((m) => m.userId))].join(",");

  useEffect(() => {
    const ids = authorKey ? authorKey.split(",") : [];
    if (ids.length > 0) {
      useUsersStore.getState().ensure(ids);
    }
  }, [authorKey]);

  async function unpin(postId: string) {
    try {
      await api.posts.unpin(channelId, postId);
      useMessageStore.getState().setPinned(channelId, postId, false);
      await queryClient.invalidateQueries({ queryKey: ["pinned", channelId] });
    } catch {
      // The server stays the source of truth; a failed unpin keeps the row.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("channel.pinned")} ({messages.length})
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-96 overflow-y-auto">
          {messages.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">{t("channel.noPinned")}</p>
          ) : (
            messages.map((message) => (
              <div key={message.id} className="border-b py-2 last:border-b-0">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {displayNameOf(byId[message.userId], message.userId)}
                  </span>
                  <time dateTime={new Date(message.createdAt).toISOString()}>
                    {timeFormatter.format(new Date(message.createdAt))}
                  </time>
                  <button
                    type="button"
                    className="ml-auto rounded px-2 py-0.5 hover:bg-accent hover:text-destructive"
                    onClick={() => void unpin(message.id)}
                  >
                    {t("channel.unpin")}
                  </button>
                </div>
                <MentionText
                  content={message.content}
                  className="whitespace-pre-wrap break-words text-sm"
                />
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
