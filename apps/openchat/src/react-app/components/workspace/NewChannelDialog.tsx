import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useTeamsStore } from "state";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function NewChannelDialog({
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
  const [type, setType] = useState<"public" | "private">("public");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    const name = displayName.trim();
    if (!name || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.channels.create({ teamId, displayName: name, type });
      useTeamsStore.getState().addChannel({
        id: res.id,
        teamId,
        name: null,
        displayName: name,
        type,
        member: true,
        archivedAt: null,
      });
      setDisplayName("");
      setType("public");
      setBusy(false);
      onOpenChange(false);
      await navigate({ to: "/$teamId/c/$channelId", params: { teamId, channelId: res.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("workspace.createChannelFailed"));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("workspace.newChannel")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="channelType">{t("workspace.channelType")}</Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as "public" | "private")}
              items={[
                { value: "public", label: t("workspace.channelTypePublic") },
                { value: "private", label: t("workspace.channelTypePrivate") },
              ]}
            >
              <SelectTrigger id="channelType" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">{t("workspace.channelTypePublic")}</SelectItem>
                <SelectItem value="private">{t("workspace.channelTypePrivate")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="channelName">{t("workspace.channelName")}</Label>
            <Input
              id="channelName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="sm:justify-start">
          <Button
            className="w-full"
            disabled={busy || !displayName.trim()}
            onClick={() => void create()}
          >
            {t("workspace.createChannel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
