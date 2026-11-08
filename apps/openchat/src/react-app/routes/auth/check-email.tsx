import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { appClient } from "@/app-client";
import { LanguageSwitcher } from "@/components/auth/LanguageSwitcher";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/auth/check-email")({
  component: CheckEmailPage,
  validateSearch: z.object({ email: z.string().optional() }),
});

function CheckEmailPage() {
  const { email } = Route.useSearch();
  const { t } = useTranslation();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    if (!email) {
      return;
    }
    setSending(true);
    setError(null);
    setSent(false);
    try {
      await appClient.auth.sendVerificationEmail(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t("auth.checkEmail.sendFailed"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t("auth.checkEmail.title")}</CardTitle>
          <CardDescription>
            {t("auth.checkEmail.description", { email: email ?? "" })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sent && (
            <Alert>
              <AlertTitle>{t("auth.checkEmail.sent")}</AlertTitle>
              <AlertDescription>{t("auth.checkEmail.sentDescription")}</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertTitle>{t("auth.checkEmail.sendFailed")}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button onClick={resend} disabled={sending || !email} className="w-full">
            {sending ? t("auth.checkEmail.sending") : t("auth.checkEmail.resend")}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            <Link to="/auth/login" className="text-primary underline-offset-4 hover:underline">
              {t("auth.checkEmail.backToLogin")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
