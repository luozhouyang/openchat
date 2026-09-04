import { useState } from "react";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/$teamId/settings")({
  component: TeamSettingsPage,
});

const teamIdApi = getRouteApi("/$teamId");

function TeamSettingsPage() {
  const { teamId } = Route.useParams();
  const data = teamIdApi.useLoaderData();
  const team = data.teams.find((t) => t.id === teamId);
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
      setError(err instanceof Error ? err.message : "保存失败");
    }
  }

  if (!team) return <div className="p-8">团队不存在</div>;

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-8">
      <h1 className="text-xl font-semibold">团队设置</h1>
      <div className="space-y-3 rounded border p-4">
        <div>
          <Label htmlFor="settings-name">团队名称</Label>
          <Input
            id="settings-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="settings-desc">描述</Label>
          <Input
            id="settings-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <Button onClick={() => void save()}>保存</Button>
        {saved && <span className="ml-2 text-sm text-green-600">已保存</span>}
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
      <div className="rounded border p-4">
        <h2 className="mb-2 font-semibold">成员</h2>
        {members.data?.members.map((m) => (
          <div key={m.userId} className="flex items-center justify-between py-1 text-sm">
            <span>{m.userId}</span>
            <span className="text-zinc-500">{m.roles}</span>
          </div>
        ))}
        {members.isError && <p className="text-sm text-red-600">无法加载成员</p>}
      </div>
    </div>
  );
}
