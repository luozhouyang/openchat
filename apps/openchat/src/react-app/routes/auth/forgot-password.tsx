import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { LanguageSwitcher } from "@/components/auth/LanguageSwitcher";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/auth/forgot-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);

  const emailValidator = ({ value }: { value: string }) =>
    z.string().email().safeParse(value).success ? undefined : t("auth.login.errors.email");

  const form = useForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) => {
      try {
        await authClient.requestPasswordReset({
          email: value.email,
          redirectTo: "/auth/reset-password",
        });
      } catch {
        // Intentionally ignored: the same confirmation is shown for known and
        // unknown addresses so the page cannot be used for account enumeration.
      } finally {
        setSent(true);
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
          <CardTitle className="text-xl">{t("auth.forgotPasswordTitle")}</CardTitle>
          <CardDescription>{t("auth.forgotPasswordHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <Alert>
              <AlertTitle>{t("auth.resetLinkSent")}</AlertTitle>
            </Alert>
          ) : (
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
              <form.Subscribe selector={(s) => ({ isSubmitting: s.isSubmitting })}>
                {({ isSubmitting }) => (
                  <Button type="submit" disabled={isSubmitting} className="w-full">
                    {t("auth.sendResetLink")}
                  </Button>
                )}
              </form.Subscribe>
            </form>
          )}
          <p className="mt-4 text-center text-sm text-muted-foreground">
            <Link to="/auth/login" className="text-primary underline-offset-4 hover:underline">
              {t("auth.backToLogin")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
