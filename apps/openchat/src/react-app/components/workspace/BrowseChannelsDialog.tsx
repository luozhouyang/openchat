import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ChannelSummary } from "protocol";
import { useTeamsStore } from "state";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HashIcon, LockIcon } from "lucide-react";

export function BrowseChannelsDialog({
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
  const queryClient = useQueryClient();
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["team-channels", teamId],
    queryFn: () => api.channels.listByTeam(teamId),
    enabled: open,
  });
  const channels = data?.channels ?? [];

  async function join(channel: ChannelSummary) {
    setJoining(channel.id);
    setError(null);
    try {
      await api.channels.join(channel.id);
      useTeamsStore.getState().addChannel({ ...channel, member: true });
      await queryClient.invalidateQueries({ queryKey: ["team-channels", teamId] });
      onOpenChange(false);
      await navigate({
        to: "/$teamId/c/$channelId",
        params: { teamId, channelId: channel.id },
      });
    } catch {
      setError(t("workspace.joinChannelFailed"));
    } finally {
      setJoining(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("workspace.browseChannels")}</DialogTitle>
        </DialogHeader>
        <div className="max-h-96 overflow-y-auto">
          {channels.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">{t("workspace.noBrowseChannels")}</p>
          ) : (
            channels.map((channel) => (
              <div
                key={channel.id}
                className="flex items-center gap-2 border-b py-2 last:border-b-0"
              >
                {channel.type === "private" ? (
                  <LockIcon className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <HashIcon className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm">{channel.displayName}</span>
                {channel.member ? (
                  <span className="text-xs text-muted-foreground">{t("workspace.joined")}</span>
                ) : channel.type === "public" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={joining === channel.id}
                    onClick={() => void join(channel)}
                  >
                    {t("workspace.join")}
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">{t("workspace.inviteOnly")}</span>
                )}
              </div>
            ))
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
