import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { authClient } from "../../lib/auth-client";
import { LanguageSwitcher } from "../../components/auth/LanguageSwitcher";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";

export const Route = createFileRoute("/auth/verify-email")({
  component: VerifyEmailPage,
  validateSearch: z.object({
    error: z.string().optional(),
    email: z.string().optional(),
    token: z.string().optional(),
  }),
});

function VerifyEmailPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "success" | "error">(
    search.token ? "loading" : search.error ? "error" : "success",
  );
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!search.token || startedRef.current) return;
    startedRef.current = true;
    authClient
      .verifyEmail({ query: { token: search.token, callbackURL: "/auth/verify-email" } })
      .then((res) => {
        if (res.error) throw new Error(res.error.message ?? t("auth.verifyEmail.failTitle"));
        setState("success");
        void navigate({ to: "/auth/verify-email", search: {}, replace: true });
      })
      .catch((err) => {
        setVerifyError(err instanceof Error ? err.message : t("auth.verifyEmail.failTitle"));
        setState("error");
      });
  }, [search.token, t, navigate]);

  async function resend() {
    if (!search.email) return;
    setSending(true);
    setSendError(null);
    setSent(false);
    try {
      const res = await authClient.sendVerificationEmail({
        email: search.email,
        callbackURL: "/auth/verify-email",
      });
      if (res.error) throw new Error(res.error.message ?? t("auth.verifyEmail.sendFailed"));
      setSent(true);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : t("auth.verifyEmail.sendFailed"));
    } finally {
      setSending(false);
    }
  }

  if (state === "loading") {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
        <div className="absolute top-4 right-4">
          <LanguageSwitcher />
        </div>
        <p className="text-sm text-muted-foreground">{t("auth.verifyEmail.verifying")}</p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
        <div className="absolute top-4 right-4">
          <LanguageSwitcher />
        </div>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-xl">{t("auth.verifyEmail.failTitle")}</CardTitle>
            <CardDescription>{t("auth.verifyEmail.failDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <AlertTitle>{t("auth.verifyEmail.failAlertTitle")}</AlertTitle>
              <AlertDescription>{verifyError ?? search.error}</AlertDescription>
            </Alert>
            {sent && (
              <Alert>
                <AlertTitle>{t("auth.verifyEmail.sent")}</AlertTitle>
                <AlertDescription>{t("auth.verifyEmail.sentDescription")}</AlertDescription>
              </Alert>
            )}
            {sendError && (
              <Alert variant="destructive">
                <AlertTitle>{t("auth.verifyEmail.sendFailed")}</AlertTitle>
                <AlertDescription>{sendError}</AlertDescription>
              </Alert>
            )}
            {search.email && (
              <Button onClick={resend} disabled={sending} className="w-full">
                {sending ? t("auth.verifyEmail.sending") : t("auth.verifyEmail.resend")}
              </Button>
            )}
            <p className="text-center text-sm text-muted-foreground">
              <Link to="/auth/login" className="text-primary underline-offset-4 hover:underline">
                {t("auth.verifyEmail.backToLogin")}
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t("auth.verifyEmail.successTitle")}</CardTitle>
          <CardDescription>{t("auth.verifyEmail.successDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={() => void navigate({ to: "/" })} className="w-full">
            {t("auth.verifyEmail.enterWorkspace")}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            <Link to="/auth/login" className="text-primary underline-offset-4 hover:underline">
              {t("auth.verifyEmail.signInAgain")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
