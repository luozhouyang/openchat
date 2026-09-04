import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { authClient } from "../../lib/auth-client";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { FormField } from "../../components/ui/form-field";
import { Input } from "../../components/ui/input";

export const Route = createFileRoute("/auth/signup")({
  component: SignupPage,
});

function SignupPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { name: "", email: "", password: "" },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const res = await authClient.signUp.email({
          name: value.name,
          email: value.email,
          password: value.password,
        });
        if (res.error) throw new Error(res.error.message ?? "注册失败");
        void router.navigate({ to: "/auth/check-email", search: { email: value.email } });
      } catch (err) {
        setError(err instanceof Error ? err.message : "注册失败");
      }
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">注册 openchat</CardTitle>
          <CardDescription>创建你的账号，验证邮箱后开始协作</CardDescription>
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
              validators={{
                onChange: z.string().min(1, "请输入昵称"),
                onSubmit: z.string().min(1, "请输入昵称"),
              }}
            >
              {(field) => (
                <FormField field={field} label="昵称">
                  {(f) => (
                    <Input
                      id={f.name}
                      name={f.name}
                      autoComplete="name"
                      placeholder="昵称"
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
              validators={{
                onChange: z.string().email("请输入有效的邮箱地址"),
                onSubmit: z.string().email("请输入有效的邮箱地址"),
              }}
            >
              {(field) => (
                <FormField field={field} label="邮箱">
                  {(f) => (
                    <Input
                      type="email"
                      id={f.name}
                      name={f.name}
                      autoComplete="email"
                      placeholder="you@example.com"
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
              validators={{
                onChange: z.string().min(8, "密码至少 8 位"),
                onSubmit: z.string().min(8, "密码至少 8 位"),
              }}
            >
              {(field) => (
                <FormField field={field} label="密码">
                  {(f) => (
                    <Input
                      type="password"
                      id={f.name}
                      name={f.name}
                      autoComplete="new-password"
                      placeholder="至少 8 位密码"
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
                <AlertTitle>注册失败</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <form.Subscribe selector={(s) => ({ isSubmitting: s.isSubmitting })}>
              {({ isSubmitting }) => (
                <Button type="submit" disabled={isSubmitting} className="w-full">
                  {isSubmitting ? "注册中…" : "注册"}
                </Button>
              )}
            </form.Subscribe>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            已有账号？{" "}
            <Link to="/auth/login" className="text-primary underline-offset-4 hover:underline">
              登录
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
