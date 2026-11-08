import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { ChannelSummary, PostOutput } from "protocol";
import { api } from "@/lib/api";
import { displayNameOf, useUsersStore } from "@/stores/users";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MentionText } from "./MentionText";

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

type Scope = "channel" | "all";

interface Result {
  message: PostOutput;
  channel?: ChannelSummary;
}

export function SearchDialog({
  channelId,
  open,
  onOpenChange,
}: {
  channelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const byId = useUsersStore((s) => s.byId);
  const [term, setTerm] = useState("");
  const [scope, setScope] = useState<Scope>("channel");
  const [results, setResults] = useState<Result[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const query = term.trim();
    if (!open || query.length === 0) {
      setResults([]);
      return;
    }
    let active = true;
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        if (scope === "channel") {
          const res = await api.posts.search(channelId, query);
          if (active) {
            setResults(res.messages.map((message) => ({ message })));
          }
        } else {
          const res = await api.search.global(query);
          if (active) {
            setResults(res.hits.map((hit) => ({ message: hit.message, channel: hit.channel })));
          }
        }
      } catch {
        if (active) {
          setResults([]);
        }
      } finally {
        if (active) {
          setSearching(false);
        }
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [term, open, channelId, scope]);

  const authorKey = useMemo(
    () => [...new Set(results.map((result) => result.message.userId))].join(","),
    [results],
  );
  useEffect(() => {
    const ids = authorKey ? authorKey.split(",") : [];
    if (ids.length > 0) {
      useUsersStore.getState().ensure(ids);
    }
  }, [authorKey]);

  async function openResult(result: Result) {
    onOpenChange(false);
    if (scope === "channel" || !result.channel) {
      window.dispatchEvent(
        new CustomEvent("openchat:jump-to-seq", {
          detail: { channelId, seq: result.message.seq },
        }),
      );
      return;
    }
    sessionStorage.setItem(`openchat:jump:${result.channel.id}`, String(result.message.seq));
    if (result.channel.teamId) {
      await navigate({
        to: "/$teamId/c/$channelId",
        params: { teamId: result.channel.teamId, channelId: result.channel.id },
      });
    } else {
      await navigate({ to: "/dm/$channelId", params: { channelId: result.channel.id } });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("channel.search")}</DialogTitle>
        </DialogHeader>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={scope === "channel" ? "default" : "outline"}
            onClick={() => setScope("channel")}
          >
            {t("channel.scopeChannel")}
          </Button>
          <Button
            size="sm"
            variant={scope === "all" ? "default" : "outline"}
            onClick={() => setScope("all")}
          >
            {t("channel.scopeAll")}
          </Button>
        </div>
        <input
          autoFocus
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={t("channel.searchPlaceholder")}
          aria-label={t("channel.searchPlaceholder")}
          className="w-full rounded border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="max-h-96 overflow-y-auto">
          {term.trim().length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">{t("channel.searchHint")}</p>
          ) : searching ? (
            <p className="py-4 text-sm text-muted-foreground">{t("channel.searching")}</p>
          ) : results.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">{t("channel.noResults")}</p>
          ) : (
            results.map((result) => (
              <button
                key={`${result.channel?.id ?? channelId}:${result.message.id}`}
                type="button"
                onClick={() => void openResult(result)}
                className="block w-full border-b py-2 text-left last:border-b-0 hover:bg-accent"
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {result.channel && (
                    <span className="truncate font-medium text-foreground">
                      #{result.channel.displayName}
                    </span>
                  )}
                  <span className="font-medium text-foreground">
                    {displayNameOf(byId[result.message.userId], result.message.userId)}
                  </span>
                  <time dateTime={new Date(result.message.createdAt).toISOString()}>
                    {timeFormatter.format(new Date(result.message.createdAt))}
                  </time>
                </div>
                <MentionText
                  content={result.message.content}
                  className="line-clamp-2 whitespace-pre-wrap break-words text-sm"
                />
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
