import { createFileRoute, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { UserTable } from "@/components/admin/UserTable";
import { StatsCards } from "@/components/admin/StatsCards";
import { StructurePanel } from "@/components/admin/StructurePanel";
import { RolesPanel } from "@/components/admin/RolesPanel";
import { Card, CardContent } from "@/components/ui/card";
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
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="mb-4 text-xl font-semibold">{t("admin.title")}</h1>
      <Card className="mb-4">
        <CardContent className="py-2 text-sm text-muted-foreground">
          {t("admin.openRegistration")}
        </CardContent>
      </Card>
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">{t("admin.users")}</TabsTrigger>
          <TabsTrigger value="structure">{t("admin.structure")}</TabsTrigger>
          <TabsTrigger value="stats">{t("admin.stats")}</TabsTrigger>
          <TabsTrigger value="roles">{t("admin.roles")}</TabsTrigger>
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
