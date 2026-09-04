import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/teams/new")({
  component: TeamsNewPage,
});

function TeamsNewPage() {
  const permissions = usePermissions();
  const canCreate = permissions.includes("create_team");
  const navigate = useNavigate();
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
      setError(err instanceof Error ? err.message : "创建失败");
    }
  }

  async function joinTeam() {
    setError(null);
    try {
      const res = await api.teams.joinByInvite(inviteCode);
      await navigate({ to: "/$teamId", params: { teamId: res.teamId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "加入失败");
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>团队</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs key={canCreate ? "create" : "join"} defaultValue={canCreate ? "create" : "join"}>
            <TabsList>
              {canCreate && <TabsTrigger value="create">创建团队</TabsTrigger>}
              <TabsTrigger value="join">加入团队</TabsTrigger>
            </TabsList>
            {canCreate && (
              <TabsContent value="create">
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="name">标识（小写字母数字）</Label>
                    <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="displayName">团队名称</Label>
                    <Input
                      id="displayName"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="type">类型</Label>
                    <select
                      id="type"
                      className="w-full rounded border px-3 py-2 text-sm"
                      value={type}
                      onChange={(e) => setType(e.target.value as "open" | "invite")}
                    >
                      <option value="open">开放（任何人可加入）</option>
                      <option value="invite">邀请制（需邀请码）</option>
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="description">描述（可选）</Label>
                    <Input
                      id="description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </div>
                  <Button className="w-full" onClick={createTeam}>
                    创建
                  </Button>
                </div>
              </TabsContent>
            )}
            <TabsContent value="join">
              <div className="space-y-3">
                <div>
                  <Label htmlFor="inviteCode">邀请码</Label>
                  <Input
                    id="inviteCode"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                  />
                </div>
                <Button className="w-full" onClick={joinTeam}>
                  加入
                </Button>
              </div>
            </TabsContent>
          </Tabs>
          {created && (
            <div className="mt-4 space-y-3">
              {created.inviteCode && (
                <p className="rounded border bg-muted/40 px-3 py-2 text-sm">
                  邀请码：<span className="font-mono">{created.inviteCode}</span>
                </p>
              )}
              <Button
                className="w-full"
                onClick={() => navigate({ to: "/$teamId", params: { teamId: created.id } })}
              >
                进入团队
              </Button>
            </div>
          )}
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
