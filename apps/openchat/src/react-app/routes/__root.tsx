import { useEffect } from "react";
import { createRootRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { appClient } from "@/app-client";
import { wsClient } from "@/ws/client";

const PUBLIC_PATHS = ["/auth/login", "/auth/signup", "/auth/check-email", "/auth/verify-email"];

// beforeLoad runs on every navigation; probe cheaply with a short-lived
// positive cache (the cookie-mode equivalent of better-auth's cookieCache).
let sessionProbedAt = 0;
let sessionProbedOk = false;

export async function guardSession(): Promise<boolean> {
  if (sessionProbedOk && Date.now() - sessionProbedAt < 60_000) {
    return true;
  }
  const ok = await appClient.auth.hasSession();
  if (ok) {
    sessionProbedAt = Date.now();
    sessionProbedOk = true;
  } else {
    sessionProbedOk = false;
  }
  return ok;
}

/**
 * App-level realtime connection (p10 §4.1): one socket per tab for the whole
 * authenticated session, independent of team/channel navigation. Also feeds
 * the server's presence/push-suppression state with throttled activity
 * frames on real user interaction (system design §5.5).
 */
function ConnectionManager() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const authed = !PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (!authed) {
      return;
    }
    void wsClient.ensureConnected();
    let lastSent = 0;
    const activity = () => {
      const now = Date.now();
      if (now - lastSent < 30_000) {
        return;
      }
      lastSent = now;
      wsClient.sendActivity();
    };
    activity();
    window.addEventListener("pointerdown", activity, { passive: true });
    window.addEventListener("keydown", activity, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
    };
  }, [authed]);

  return null;
}

export const Route = createRootRoute({
  component: () => (
    <>
      <ConnectionManager />
      <Outlet />
    </>
  ),
  beforeLoad: async ({ location }) => {
    if (PUBLIC_PATHS.some((p) => location.pathname.startsWith(p))) {
      return;
    }
    if (!(await guardSession())) {
      throw redirect({ to: "/auth/login" });
    }
  },
});
