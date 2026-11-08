import { useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ThreadInfo } from "protocol";
import { useTeamsStore } from "state";
import { api } from "@/lib/api";
import { displayNameOf, useUsersStore } from "@/stores/users";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function ThreadsDialog({
  teamId,
  open,
  onOpenChange,
}: {
  teamId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const team = useTeamsStore((s) => s.teams.find((entry) => entry.id === teamId));
  const byId = useUsersStore((s) => s.byId);
  const { data } = useQuery({
    queryKey: ["my-threads", teamId],
    queryFn: () => api.threads.mine(teamId),
    enabled: open,
  });

  const threads = useMemo(
    () => [...(data?.threads ?? [])].sort((a, b) => (b.lastReplyAt ?? 0) - (a.lastReplyAt ?? 0)),
    [data],
  );

  const participantKey = [...new Set(threads.flatMap((thread) => thread.participants))].join(",");
  useEffect(() => {
    const ids = participantKey ? participantKey.split(",") : [];
    if (ids.length > 0) {
      useUsersStore.getState().ensure(ids);
    }
  }, [participantKey]);

  function channelName(channelId: string | null): string {
    if (!channelId) {
      return "";
    }
    return team?.channels.find((channel) => channel.id === channelId)?.displayName ?? channelId;
  }

  async function openThread(thread: ThreadInfo) {
    if (!thread.channelId) {
      return;
    }
    onOpenChange(false);
    await navigate({
      to: "/$teamId/c/$channelId/t/$threadId",
      params: { teamId, channelId: thread.channelId, threadId: thread.postId },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("workspace.threads")}</DialogTitle>
        </DialogHeader>
        <div className="max-h-96 overflow-y-auto">
          {threads.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">{t("workspace.noThreads")}</p>
          ) : (
            threads.map((thread) => (
              <button
                key={`${thread.channelId}:${thread.postId}`}
                type="button"
                className="block w-full border-b py-2 text-left last:border-b-0 hover:bg-accent"
                onClick={() => void openThread(thread)}
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate font-medium text-foreground">
                    {channelName(thread.channelId)}
                  </span>
                  <span>{t("workspace.replyCount", { count: thread.replyCount })}</span>
                  {thread.lastReplyAt && (
                    <time dateTime={new Date(thread.lastReplyAt).toISOString()}>
                      {timeFormatter.format(new Date(thread.lastReplyAt))}
                    </time>
                  )}
                </div>
                <div className="truncate text-sm">
                  {thread.participants
                    .map((userId) => displayNameOf(byId[userId], userId))
                    .join(", ")}
                </div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
