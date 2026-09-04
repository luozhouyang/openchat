import { useState } from "react";
import { createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ArrowLeftIcon } from "lucide-react";

export const Route = createFileRoute("/$teamId/settings")({
  component: TeamSettingsPage,
});

const teamIdApi = getRouteApi("/$teamId");

function TeamSettingsPage() {
  const { teamId } = Route.useParams();
  const data = teamIdApi.useLoaderData();
  const team = data.teams.find((tm) => tm.id === teamId);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(team?.displayName ?? "");
  const [description, setDescription] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const members = useQuery({
    queryKey: ["team-members", teamId],
    queryFn: () => api.teams.listMembers(teamId),
    enabled: !!team,
  });

  async function save() {
    setError(null);
    try {
      await api.teams.patch(teamId, {
        displayName: displayName || undefined,
        description: description || undefined,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("teams.saveFailed"));
    }
  }

  if (!team) return <div className="p-8">{t("teams.notFound")}</div>;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <Card>
        <CardHeader>
          <CardTitle>{t("teams.settingsTitle")}</CardTitle>
          <CardAction>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => navigate({ to: "/$teamId", params: { teamId } })}
            >
              <ArrowLeftIcon />
              <span className="sr-only">Back</span>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="settings-name">{t("teams.teamName")}</Label>
            <Input
              id="settings-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="settings-desc">{t("teams.description")}</Label>
            <Input
              id="settings-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => void save()}>{t("teams.save")}</Button>
            {saved && <span className="text-sm text-green-600">{t("teams.saved")}</span>}
            {error && <span className="text-sm text-destructive">{error}</span>}
          </div>
        </CardContent>
      </Card>
      <Separator />
      <Card>
        <CardHeader>
          <CardTitle>{t("teams.members")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {members.data?.members.map((m) => (
            <div key={m.userId} className="flex items-center justify-between py-1 text-sm">
              <span>{m.userId}</span>
              <Badge variant="outline">{m.roles}</Badge>
            </div>
          ))}
          {members.isError && (
            <p className="text-sm text-destructive">{t("teams.membersLoadFailed")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
