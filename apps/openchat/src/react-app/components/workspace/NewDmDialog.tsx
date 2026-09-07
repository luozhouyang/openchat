import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { UserAutocompleteItem } from "protocol";
import { api } from "@/lib/api";
import { useMe } from "@/hooks/use-me";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchIcon } from "lucide-react";

export function NewDmDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<UserAutocompleteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const q = term.trim();
    if (!open || !q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await api.users.autocomplete(q);
        if (!active) {
          return;
        }
        setResults(res.users);
        setError(null);
      } catch (err) {
        if (active) {
          setResults([]);
          setError(err instanceof Error ? err.message : t("workspace.dmSearchFailed"));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [term, open, t]);

  async function start(user: UserAutocompleteItem) {
    if (!me) {
      return;
    }
    try {
      const res = await api.channels.openDirect({ userIds: [me.id, user.id] });
      setTerm("");
      setResults([]);
      onOpenChange(false);
      await navigate({ to: "/dm/$channelId", params: { channelId: res.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("workspace.dmSearchFailed"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("workspace.newDm")}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t("workspace.dmSearchPlaceholder")}
            className="ps-9"
          />
        </div>
        <div className="flex max-h-72 flex-col gap-0.5 overflow-auto">
          {loading && <p className="px-1 py-2 text-sm text-muted-foreground">…</p>}
          {!loading && !error && results.length === 0 && term.trim() !== "" && (
            <p className="px-1 py-2 text-sm text-muted-foreground">
              {t("workspace.dmSearchEmpty")}
            </p>
          )}
          {error && <p className="px-1 py-2 text-sm text-destructive">{error}</p>}
          {results.map((u) => {
            const label = u.nickname ?? u.username ?? u.name;
            const initials = (label ?? "?").slice(0, 2).toUpperCase();
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => void start(u)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start hover:bg-sidebar-accent"
              >
                {u.avatarUrl ? (
                  <img
                    src={u.avatarUrl}
                    alt=""
                    className="size-6 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="grid size-6 shrink-0 place-items-center rounded-full bg-sidebar-primary text-[10px] font-semibold text-sidebar-primary-foreground">
                    {initials}
                  </div>
                )}
                <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
                {u.username && (
                  <span className="shrink-0 text-xs text-muted-foreground">@{u.username}</span>
                )}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
