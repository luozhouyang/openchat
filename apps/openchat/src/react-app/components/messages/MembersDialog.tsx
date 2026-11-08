import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { UserAutocompleteItem } from "protocol";
import { api } from "@/lib/api";
import { useStatus } from "@/stores/presence";
import { displayNameOf, initialsOf, useUsersStore } from "@/stores/users";
import { StatusDot } from "@/components/presence/StatusDot";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

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
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["channel-members", channelId],
    queryFn: () => api.channels.listMembers(channelId, { perPage: 200 }),
    enabled: open,
  });
  const memberIds = data?.memberIds ?? [];
  const memberKey = memberIds.join(",");

  // Same cache entry as the header: one detail request drives both the title
  // and the member-management affordance.
  const { data: channelData } = useQuery({
    queryKey: ["channel", channelId],
    queryFn: () => api.channels.get(channelId),
    enabled: open,
  });
  const isAdmin = channelData?.channel.callerRole === "admin";

  const [term, setTerm] = useState("");
  const [results, setResults] = useState<UserAutocompleteItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (memberIds.length > 0) {
      useUsersStore.getState().ensure(memberIds);
    }
    // memberIds is derived from the query; key the effect by its contents.
  }, [memberKey]);

  useEffect(() => {
    let active = true;
    const q = term.trim();
    if (!open || !isAdmin || !q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      void api.users
        .autocomplete(q)
        .then((res) => {
          if (active) {
            setResults(res.users);
          }
        })
        .catch(() => {
          if (active) {
            setResults([]);
          }
        })
        .finally(() => {
          if (active) {
            setSearching(false);
          }
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [term, open, isAdmin]);

  const candidates = results.filter((user) => !memberIds.includes(user.id));
  const showEmpty = !searching && term.trim() !== "" && candidates.length === 0;

  async function add(user: UserAutocompleteItem) {
    setAddingId(user.id);
    setNotice(null);
    try {
      await api.channels.addMember(channelId, user.id);
      await queryClient.invalidateQueries({ queryKey: ["channel-members", channelId] });
      setNotice(t("channel.memberAdded"));
      setResults((rows) => rows.filter((row) => row.id !== user.id));
    } catch {
      // Keep the row so the admin can retry; there is no toast system.
    } finally {
      setAddingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("channel.members")} ({memberIds.length})
          </DialogTitle>
        </DialogHeader>
        {isAdmin && (
          <div className="space-y-2 border-b pb-3">
            <div className="text-sm font-medium">{t("channel.addMember")}</div>
            <Input
              value={term}
              onChange={(event) => {
                setTerm(event.target.value);
                setNotice(null);
              }}
              placeholder={t("channel.addMemberPlaceholder")}
            />
            {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
            {searching && <p className="py-1 text-sm text-muted-foreground">…</p>}
            {showEmpty && (
              <p className="py-1 text-sm text-muted-foreground">{t("channel.noUsersFound")}</p>
            )}
            {candidates.length > 0 && (
              <div className="max-h-40 overflow-y-auto">
                {candidates.map((user) => (
                  <div key={user.id} className="flex items-center gap-2 py-1">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {displayNameOf(user, user.id)}
                      {user.username && (
                        <span className="ms-1 text-xs text-muted-foreground">@{user.username}</span>
                      )}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={addingId !== null}
                      onClick={() => void add(user)}
                    >
                      {addingId === user.id ? "…" : t("channel.addMember")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
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
