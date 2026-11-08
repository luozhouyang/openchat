import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { LanguageSwitcher } from "@/components/auth/LanguageSwitcher";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/auth/reset-password")({
  component: ResetPasswordPage,
  validateSearch: (search: Record<string, unknown>) => ({ token: String(search.token ?? "") }),
});

function BackToLoginLink({ label }: { label: string }) {
  return (
    <p className="text-center text-sm text-muted-foreground">
      <Link to="/auth/login" className="text-primary underline-offset-4 hover:underline">
        {label}
      </Link>
    </p>
  );
}

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);

  const passwordValidator = ({ value }: { value: string }) =>
    z.string().min(8).safeParse(value).success ? undefined : t("auth.signup.errors.password");

  const form = useForm({
    defaultValues: { newPassword: "" },
    onSubmit: async ({ value }) => {
      setFailed(false);
      try {
        const { error } = await authClient.resetPassword({ newPassword: value.newPassword, token });
        if (error) {
          setFailed(true);
          return;
        }
        setDone(true);
      } catch {
        // Surface every failure with the same message; the API error text is not
        // useful to the user and may reveal token details.
        setFailed(true);
      }
    },
  });

  const invalidToken = token.length === 0;

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t("auth.forgotPasswordTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="space-y-4">
              <Alert>
                <AlertTitle>{t("auth.resetPasswordDone")}</AlertTitle>
              </Alert>
              <BackToLoginLink label={t("auth.backToLogin")} />
            </div>
          ) : invalidToken ? (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertTitle>{t("auth.resetLinkInvalid")}</AlertTitle>
              </Alert>
              <BackToLoginLink label={t("auth.backToLogin")} />
            </div>
          ) : (
            <div className="space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void form.handleSubmit();
                }}
                className="space-y-4"
              >
                <form.Field
                  name="newPassword"
                  validators={{ onChange: passwordValidator, onSubmit: passwordValidator }}
                >
                  {(field) => (
                    <FormField field={field} label={t("auth.newPassword")}>
                      {(f) => (
                        <Input
                          id={f.name}
                          name={f.name}
                          type="password"
                          autoComplete="new-password"
                          placeholder={t("auth.signup.passwordPlaceholder")}
                          value={f.state.value}
                          onChange={(e) => f.handleChange(e.target.value)}
                          onBlur={f.handleBlur}
                          aria-invalid={f.state.meta.errors.length > 0}
                        />
                      )}
                    </FormField>
                  )}
                </form.Field>
                {failed && (
                  <Alert variant="destructive">
                    <AlertTitle>{t("auth.resetLinkInvalid")}</AlertTitle>
                  </Alert>
                )}
                <form.Subscribe selector={(s) => ({ isSubmitting: s.isSubmitting })}>
                  {({ isSubmitting }) => (
                    <Button type="submit" disabled={isSubmitting} className="w-full">
                      {t("auth.resetPassword")}
                    </Button>
                  )}
                </form.Subscribe>
              </form>
              <BackToLoginLink label={t("auth.backToLogin")} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
