import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useStatus } from "@/stores/presence";
import { displayNameOf, initialsOf, useUsersStore } from "@/stores/users";
import { StatusDot } from "@/components/presence/StatusDot";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function MembersDialog({
  channelId,
  open,
  onOpenChange,
}: {
  channelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ["channel-members", channelId],
    queryFn: () => api.channels.listMembers(channelId, { perPage: 200 }),
    enabled: open,
  });
  const memberIds = data?.memberIds ?? [];
  const memberKey = memberIds.join(",");

  useEffect(() => {
    if (memberIds.length > 0) {
      useUsersStore.getState().ensure(memberIds);
    }
    // memberIds is derived from the query; key the effect by its contents.
  }, [memberKey]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("channel.members")} ({memberIds.length})
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-96 overflow-y-auto">
          {memberIds.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">{t("channel.noMembers")}</p>
          ) : (
            memberIds.map((memberId) => <MemberRow key={memberId} memberId={memberId} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MemberRow({ memberId }: { memberId: string }) {
  const user = useUsersStore((s) => s.byId[memberId]);
  const status = useStatus(memberId);
  const name = displayNameOf(user, memberId);
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="relative shrink-0">
        {user?.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt=""
            className="size-8 rounded-full bg-muted object-cover"
            loading="lazy"
          />
        ) : (
          <div className="grid size-8 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
            {initialsOf(name)}
          </div>
        )}
        <StatusDot
          status={status}
          className="absolute -right-0.5 -bottom-0.5 ring-2 ring-background"
        />
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm">{name}</div>
        {user?.username && (
          <div className="truncate text-xs text-muted-foreground">@{user.username}</div>
        )}
      </div>
    </div>
  );
}
