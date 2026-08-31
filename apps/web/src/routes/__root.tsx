import { createRootRoute, Outlet, redirect } from "@tanstack/react-router";
import { authClient } from "../lib/auth-client";

export const Route = createRootRoute({
  component: () => <Outlet />,
  beforeLoad: async ({ location }) => {
    if (location.pathname === "/login" || location.pathname === "/signup") return;
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({ to: "/login" });
    }
  },
});
