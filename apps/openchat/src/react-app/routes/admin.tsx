import { createFileRoute, redirect } from "@tanstack/react-router";

import { UserTable } from "@/components/admin/UserTable";
import { StatsCards } from "@/components/admin/StatsCards";
import { StructurePanel } from "@/components/admin/StructurePanel";
import { RolesPanel } from "@/components/admin/RolesPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (session.data?.user.role !== "admin") throw redirect({ to: "/" });
  },
});

function AdminPage() {
  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="mb-4 text-xl font-semibold">管理控制台</h1>
      <p className="mb-4 rounded border bg-muted/40 px-3 py-2 text-sm text-zinc-600">
        平台注册永久开放（openRegistration: true）
      </p>
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">用户</TabsTrigger>
          <TabsTrigger value="structure">结构</TabsTrigger>
          <TabsTrigger value="stats">统计</TabsTrigger>
          <TabsTrigger value="roles">角色</TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <UserTable />
        </TabsContent>
        <TabsContent value="structure">
          <StructurePanel />
        </TabsContent>
        <TabsContent value="stats">
          <StatsCards />
        </TabsContent>
        <TabsContent value="roles">
          <RolesPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
