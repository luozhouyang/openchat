import { useState } from "react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/teams/new")({
  component: TeamsNewPage,
  validateSearch: z.object({ tab: z.enum(["create", "join"]).optional() }),
});

function TeamsNewPage() {
  const permissions = usePermissions();
  const canCreate = permissions.includes("create_team");
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const { t } = useTranslation();
  const [open] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [type, setType] = useState<"open" | "invite">("open");
  const [description, setDescription] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [created, setCreated] = useState<{ id: string; inviteCode?: string } | null>(null);

  async function createTeam() {
    setError(null);
    try {
      const res = await api.teams.create({
        name,
        displayName,
        type,
        description: description || undefined,
      });
      if (type === "invite") {
        setCreated({ id: res.id, inviteCode: res.inviteCode ?? undefined });
        return;
      }
      await navigate({ to: "/$teamId", params: { teamId: res.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("teams.createFailed"));
    }
  }

  async function joinTeam() {
    setError(null);
    try {
      const res = await api.teams.joinByInvite(inviteCode);
      await navigate({ to: "/$teamId", params: { teamId: res.teamId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("teams.joinFailed"));
    }
  }

  function handleClose() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.history.back();
    } else {
      void navigate({ to: "/dm" });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          handleClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("teams.title")}</DialogTitle>
        </DialogHeader>
        <Tabs
          key={`${canCreate}-${tab ?? ""}`}
          defaultValue={tab === "join" || !canCreate ? "join" : "create"}
        >
          <TabsList>
            {canCreate && <TabsTrigger value="create">{t("teams.createTab")}</TabsTrigger>}
            <TabsTrigger value="join">{t("teams.joinTab")}</TabsTrigger>
          </TabsList>
          {canCreate && (
            <TabsContent value="create" className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">{t("teams.identifier")}</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="displayName">{t("teams.teamName")}</Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="type">{t("teams.type")}</Label>
                <Select
                  value={type}
                  onValueChange={(v) => setType(v as "open" | "invite")}
                  items={[
                    { value: "open", label: t("teams.typeOpen") },
                    { value: "invite", label: t("teams.typeInvite") },
                  ]}
                >
                  <SelectTrigger id="type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">{t("teams.typeOpen")}</SelectItem>
                    <SelectItem value="invite">{t("teams.typeInvite")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">{t("teams.description")}</Label>
                <Input
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <DialogFooter className="sm:justify-start">
                <Button className="w-full" onClick={() => void createTeam()}>
                  {t("teams.create")}
                </Button>
              </DialogFooter>
            </TabsContent>
          )}
          <TabsContent value="join" className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="inviteCode">{t("teams.inviteCode")}</Label>
              <Input
                id="inviteCode"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
              />
            </div>
            <DialogFooter className="sm:justify-start">
              <Button className="w-full" onClick={() => void joinTeam()}>
                {t("teams.join")}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
        {created && (
          <div className="space-y-3">
            {created.inviteCode && (
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                {t("teams.inviteCodeShown", { code: created.inviteCode })}
              </p>
            )}
            <Button
              className="w-full"
              onClick={() => navigate({ to: "/$teamId", params: { teamId: created.id } })}
            >
              {t("teams.enterTeam")}
            </Button>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
