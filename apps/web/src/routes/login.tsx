import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { appClient } from "../app-client";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Shared auth service: cookie session in the browser, safeStorage
      // bearer token in the Electron file:// shell.
      await appClient.auth.signIn(email, password);
      void router.navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <form onSubmit={submit} className="w-80 space-y-3">
        <h1 className="text-xl font-semibold">登录 openchat</h1>
        <Input
          type="email"
          placeholder="邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          type="password"
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          登录
        </Button>
        <a className="block text-sm text-center text-blue-600" href="/signup">
          注册新账号
        </a>
      </form>
    </div>
  );
}
