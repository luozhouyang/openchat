import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useTeamsStore } from "state";
import { api } from "@/lib/api";
import { useMe } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ChannelSettingsInitial {
  displayName: string;
  purpose: string | null;
  header: string | null;
}

export function ChannelSettingsDialog({
  channelId,
  open,
  onOpenChange,
  initial,
}: {
  channelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: ChannelSettingsInitial;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [purpose, setPurpose] = useState(initial?.purpose ?? "");
  const [header, setHeader] = useState(initial?.header ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Once the admin edits a field, a late `initial` refetch must not clobber it.
  const dirty = useRef(false);

  useEffect(() => {
    if (!open) {
      dirty.current = false;
      return;
    }
    if (!initial || dirty.current) {
      return;
    }
    setDisplayName(initial.displayName);
    setPurpose(initial.purpose ?? "");
    setHeader(initial.header ?? "");
    setError(null);
  }, [open, initial]);

  async function leave() {
    if (!me || !window.confirm(t("channel.leaveConfirm"))) {
      return;
    }
    try {
      await api.channels.leave(channelId, me.id);
      useTeamsStore.getState().removeChannel(channelId);
      onOpenChange(false);
      await navigate({ to: "/dm" });
    } catch {
      setError(t("channel.leaveFailed"));
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await api.channels.update(channelId, {
        displayName: displayName.trim() || undefined,
        purpose: purpose.trim() ? purpose.trim() : null,
        header: header.trim() ? header.trim() : null,
      });
      useTeamsStore.getState().patchChannel(res.channel);
      await queryClient.invalidateQueries({ queryKey: ["channel", channelId] });
      onOpenChange(false);
    } catch {
      setError(t("channel.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("channel.settings")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("channel.displayName")}</span>
            <input
              value={displayName}
              onChange={(event) => {
                dirty.current = true;
                setDisplayName(event.target.value);
              }}
              className="w-full rounded border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("channel.purpose")}</span>
            <input
              value={purpose}
              onChange={(event) => {
                dirty.current = true;
                setPurpose(event.target.value);
              }}
              className="w-full rounded border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("channel.header")}</span>
            <textarea
              value={header}
              onChange={(event) => {
                dirty.current = true;
                setHeader(event.target.value);
              }}
              rows={3}
              className="w-full resize-none rounded border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <Button variant="destructive" size="sm" onClick={() => void leave()}>
              {t("channel.leave")}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("messages.cancel")}
              </Button>
              <Button onClick={() => void save()} disabled={saving || !displayName.trim()}>
                {t("messages.save")}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
