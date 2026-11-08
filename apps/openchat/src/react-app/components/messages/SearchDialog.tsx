import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PostOutput } from "protocol";
import { api } from "@/lib/api";
import { displayNameOf, useUsersStore } from "@/stores/users";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MentionText } from "./MentionText";

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

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
  const byId = useUsersStore((s) => s.byId);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PostOutput[]>([]);
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
        const res = await api.posts.search(channelId, query);
        if (active) {
          setResults(res.messages);
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
  }, [term, open, channelId]);

  const authorKey = [...new Set(results.map((message) => message.userId))].join(",");
  useEffect(() => {
    const ids = authorKey ? authorKey.split(",") : [];
    if (ids.length > 0) {
      useUsersStore.getState().ensure(ids);
    }
  }, [authorKey]);

  function jumpTo(message: PostOutput) {
    window.dispatchEvent(
      new CustomEvent("openchat:jump-to-seq", {
        detail: { channelId, seq: message.seq },
      }),
    );
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("channel.search")}</DialogTitle>
        </DialogHeader>
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
            results.map((message) => (
              <button
                key={message.id}
                type="button"
                onClick={() => jumpTo(message)}
                className="block w-full border-b py-2 text-left last:border-b-0 hover:bg-accent"
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {displayNameOf(byId[message.userId], message.userId)}
                  </span>
                  <time dateTime={new Date(message.createdAt).toISOString()}>
                    {timeFormatter.format(new Date(message.createdAt))}
                  </time>
                </div>
                <MentionText
                  content={message.content}
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
