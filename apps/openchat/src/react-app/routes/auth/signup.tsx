import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { LanguageSwitcher } from "@/components/auth/LanguageSwitcher";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/auth/signup")({
  component: SignupPage,
});

function SignupPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);

  const nameValidator = ({ value }: { value: string }) =>
    z.string().min(1).safeParse(value).success ? undefined : t("auth.signup.errors.name");
  const usernameValidator = ({ value }: { value: string }) =>
    z.string().min(1).safeParse(value).success ? undefined : t("auth.signup.errors.username");
  const emailValidator = ({ value }: { value: string }) =>
    z.string().email().safeParse(value).success ? undefined : t("auth.signup.errors.email");
  const passwordValidator = ({ value }: { value: string }) =>
    z.string().min(8).safeParse(value).success ? undefined : t("auth.signup.errors.password");

  const form = useForm({
    defaultValues: { name: "", username: "", email: "", password: "" },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const res = await authClient.signUp.email({
          name: value.name,
          email: value.email,
          password: value.password,
          username: value.username,
          callbackURL: "/auth/verify-email",
        } as Parameters<typeof authClient.signUp.email>[0]);
        if (res.error) {
          throw new Error(res.error.message ?? t("auth.signup.failed"));
        }
        void router.navigate({ to: "/auth/check-email", search: { email: value.email } });
      } catch (err) {
        setError(err instanceof Error ? err.message : t("auth.signup.failed"));
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
          <CardTitle className="text-xl">{t("auth.signup.title")}</CardTitle>
          <CardDescription>{t("auth.signup.subtitle")}</CardDescription>
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
              name="name"
              validators={{ onChange: nameValidator, onSubmit: nameValidator }}
            >
              {(field) => (
                <FormField field={field} label={t("auth.signup.name")}>
                  {(f) => (
                    <Input
                      id={f.name}
                      name={f.name}
                      autoComplete="name"
                      placeholder={t("auth.signup.namePlaceholder")}
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
              name="username"
              validators={{ onChange: usernameValidator, onSubmit: usernameValidator }}
            >
              {(field) => (
                <FormField field={field} label={t("auth.signup.username")}>
                  {(f) => (
                    <Input
                      id={f.name}
                      name={f.name}
                      autoComplete="username"
                      placeholder={t("auth.signup.usernamePlaceholder")}
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
              name="email"
              validators={{ onChange: emailValidator, onSubmit: emailValidator }}
            >
              {(field) => (
                <FormField field={field} label={t("auth.signup.email")}>
                  {(f) => (
                    <Input
                      id={f.name}
                      name={f.name}
                      type="email"
                      autoComplete="email"
                      placeholder={t("auth.signup.emailPlaceholder")}
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
                <FormField field={field} label={t("auth.signup.password")}>
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
            {error && (
              <Alert variant="destructive">
                <AlertTitle>{t("auth.signup.failed")}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <form.Subscribe selector={(s) => ({ isSubmitting: s.isSubmitting })}>
              {({ isSubmitting }) => (
                <Button type="submit" disabled={isSubmitting} className="w-full">
                  {isSubmitting ? t("auth.signup.submitting") : t("auth.signup.submit")}
                </Button>
              )}
            </form.Subscribe>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {t("auth.signup.hasAccount")}{" "}
            <Link to="/auth/login" className="text-primary underline-offset-4 hover:underline">
              {t("auth.signup.loginLink")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
