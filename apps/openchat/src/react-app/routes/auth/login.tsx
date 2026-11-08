import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { appClient } from "@/app-client";
import { LanguageSwitcher } from "@/components/auth/LanguageSwitcher";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/auth/login")({
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);

  const emailValidator = ({ value }: { value: string }) =>
    z.string().email().safeParse(value).success ? undefined : t("auth.login.errors.email");
  const passwordValidator = ({ value }: { value: string }) =>
    z.string().min(1).safeParse(value).success ? undefined : t("auth.login.errors.password");

  const form = useForm({
    defaultValues: { email: "", password: "" },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        // Shared AuthService (better-auth): browser cookie mode keeps working;
        // the desktop file:// shell relies on this same path to persist the
        // bearer token that the WS upgrade needs (review #14).
        await appClient.auth.signIn(value.email, value.password);
        void router.navigate({ to: "/" });
      } catch (err) {
        // i18n fallback restored (review round 2, small item): keep
        // better-auth's real message when present, localized default otherwise.
        setError(err instanceof Error && err.message ? err.message : t("auth.login.failed"));
      }
    },
  });

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t("auth.login.title")}</CardTitle>
          <CardDescription>{t("auth.login.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void form.handleSubmit();
            }}
            className="space-y-4"
          >
            <form.Field
              name="email"
              validators={{ onChange: emailValidator, onSubmit: emailValidator }}
            >
              {(field) => (
                <FormField field={field} label={t("auth.login.email")}>
                  {(f) => (
                    <Input
                      id={f.name}
                      name={f.name}
                      type="email"
                      autoComplete="email"
                      placeholder={t("auth.login.emailPlaceholder")}
                      value={f.state.value}
                      onChange={(e) => f.handleChange(e.target.value)}
                      onBlur={f.handleBlur}
                      aria-invalid={f.state.meta.errors.length > 0}
                    />
                  )}
                </FormField>
              )}
            </form.Field>
            <form.Field
              name="password"
              validators={{ onChange: passwordValidator, onSubmit: passwordValidator }}
            >
              {(field) => (
                <FormField field={field} label={t("auth.login.password")}>
                  {(f) => (
                    <Input
                      id={f.name}
                      name={f.name}
                      type="password"
                      autoComplete="current-password"
                      placeholder={t("auth.login.passwordPlaceholder")}
                      value={f.state.value}
                      onChange={(e) => f.handleChange(e.target.value)}
                      onBlur={f.handleBlur}
                      aria-invalid={f.state.meta.errors.length > 0}
                    />
                  )}
                </FormField>
              )}
            </form.Field>
            {error && (
              <Alert variant="destructive">
                <AlertTitle>{t("auth.login.failed")}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <form.Subscribe selector={(s) => ({ isSubmitting: s.isSubmitting })}>
              {({ isSubmitting }) => (
                <Button type="submit" disabled={isSubmitting} className="w-full">
                  {isSubmitting ? t("auth.login.submitting") : t("auth.login.submit")}
                </Button>
              )}
            </form.Subscribe>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {t("auth.login.noAccount")}{" "}
            <Link to="/auth/signup" className="text-primary underline-offset-4 hover:underline">
              {t("auth.login.signupLink")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
