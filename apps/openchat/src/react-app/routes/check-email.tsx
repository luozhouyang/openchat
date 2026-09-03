import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { authClient } from "../lib/auth-client";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

export const Route = createFileRoute("/check-email")({
  component: CheckEmailPage,
  validateSearch: z.object({ email: z.string().optional() }),
});

function CheckEmailPage() {
  const { email } = Route.useSearch();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    if (!email) return;
    setSending(true);
    setError(null);
    setSent(false);
    try {
      const res = await authClient.sendVerificationEmail({ email, callbackURL: "/verify-email" });
      if (res.error) throw new Error(res.error.message ?? "发送失败");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">验证你的邮箱</CardTitle>
          <CardDescription>
            验证邮件已发送至{email ? ` ${email}` : "你的邮箱"}，请点击邮件中的链接完成验证。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sent && (
            <Alert>
              <AlertTitle>已发送</AlertTitle>
              <AlertDescription>验证邮件已重新发送，请查收。</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertTitle>发送失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button onClick={resend} disabled={sending || !email} className="w-full">
            {sending ? "发送中…" : "重新发送验证邮件"}
          </Button>
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
