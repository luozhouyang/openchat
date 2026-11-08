import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { AuditTable } from "@/components/admin/AuditTable";
import { UserTable } from "@/components/admin/UserTable";
import { StatsCards } from "@/components/admin/StatsCards";
import { StructurePanel } from "@/components/admin/StructurePanel";
import { RolesPanel } from "@/components/admin/RolesPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

const MODES = [
  { value: "open", label: "admin.modeOpen" },
  { value: "invite", label: "admin.modeInvite" },
  { value: "closed", label: "admin.modeClosed" },
] as const;

type RegistrationMode = (typeof MODES)[number]["value"];

export const Route = createFileRoute("/admin")({
  component: AdminPage,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (session.data?.user.role !== "admin") {
      throw redirect({ to: "/" });
    }
  },
});

function RegistrationModeCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["admin-settings"], queryFn: api.admin.settings });
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const mode = settings.data?.registrationMode;

  async function setMode(next: RegistrationMode) {
    setSaved(false);
    setFailed(false);
    try {
      await api.admin.setRegistrationMode({ registrationMode: next });
      await queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
      setSaved(true);
    } catch {
      setFailed(true);
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{t("admin.registration")}</CardTitle>
        <CardDescription>{t("admin.modeHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm font-medium">{t("admin.registrationMode")}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("admin.registrationMode")}>
          {MODES.map(({ value, label }) => (
            <Button
              key={value}
              variant={mode === value ? "default" : "outline"}
              aria-pressed={mode === value}
              onClick={() => void setMode(value)}
            >
              {t(label)}
            </Button>
          ))}
        </div>
        {saved && <p className="text-sm text-green-600">{t("admin.modeSaved")}</p>}
        {failed && <p className="text-sm text-destructive">{t("admin.modeFailed")}</p>}
      </CardContent>
    </Card>
  );
}

function AdminPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="mb-4 text-xl font-semibold">{t("admin.title")}</h1>
      <RegistrationModeCard />
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">{t("admin.users")}</TabsTrigger>
          <TabsTrigger value="structure">{t("admin.structure")}</TabsTrigger>
          <TabsTrigger value="stats">{t("admin.stats")}</TabsTrigger>
          <TabsTrigger value="roles">{t("admin.roles")}</TabsTrigger>
          <TabsTrigger value="audit">{t("admin.audit")}</TabsTrigger>
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
        <TabsContent value="audit">
          <AuditTable />
        </TabsContent>
      </Tabs>
    </div>
  );
}
