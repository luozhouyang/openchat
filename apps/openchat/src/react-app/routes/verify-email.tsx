import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { authClient } from "../lib/auth-client";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

export const Route = createFileRoute("/verify-email")({
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
  const [state, setState] = useState<"loading" | "success" | "error">(
    search.token ? "loading" : search.error ? "error" : "success",
  );
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    if (!search.token) return;
    authClient
      .verifyEmail({ query: { token: search.token, callbackURL: "/verify-email" } })
      .then((res) => {
        if (res.error) throw new Error(res.error.message ?? "验证失败");
        setState("success");
      })
      .catch((err) => {
        setVerifyError(err instanceof Error ? err.message : "验证失败");
        setState("error");
      });
  }, [search.token]);

  async function resend() {
    if (!search.email) return;
    setSending(true);
    setSendError(null);
    setSent(false);
    try {
      const res = await authClient.sendVerificationEmail({
        email: search.email,
        callbackURL: "/verify-email",
      });
      if (res.error) throw new Error(res.error.message ?? "发送失败");
      setSent(true);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setSending(false);
    }
  }

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <p className="text-sm text-muted-foreground">正在验证邮箱…</p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-xl">验证失败</CardTitle>
            <CardDescription>验证链接无效或已过期。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <AlertTitle>无法完成验证</AlertTitle>
              <AlertDescription>{verifyError ?? search.error}</AlertDescription>
            </Alert>
            {sent && (
              <Alert>
                <AlertTitle>已发送</AlertTitle>
                <AlertDescription>验证邮件已重新发送，请查收。</AlertDescription>
              </Alert>
            )}
            {sendError && (
              <Alert variant="destructive">
                <AlertTitle>发送失败</AlertTitle>
                <AlertDescription>{sendError}</AlertDescription>
              </Alert>
            )}
            {search.email && (
              <Button onClick={resend} disabled={sending} className="w-full">
                {sending ? "发送中…" : "重新发送验证邮件"}
              </Button>
            )}
            <p className="text-center text-sm text-muted-foreground">
              <Link to="/login" className="text-primary underline-offset-4 hover:underline">
                返回登录
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">邮箱验证成功</CardTitle>
          <CardDescription>你的邮箱已通过验证，可以开始使用了。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={() => void navigate({ to: "/" })} className="w-full">
            进入工作区
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            <Link to="/login" className="text-primary underline-offset-4 hover:underline">
              重新登录
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
