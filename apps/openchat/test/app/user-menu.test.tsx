// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen, fireEvent } from "@testing-library/react";
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { UserMenu } from "@/components/workspace/UserMenu";
import { api } from "@/lib/api";
import "@/i18n";

const mockSignOut = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/app-client", () => ({
  appClient: { auth: { hasSession: async () => true, signOut: mockSignOut } },
}));
vi.mock("@/ws/client", () => ({
  wsClient: { ensureConnected: async () => {}, sendActivity: () => {}, send: () => {} },
}));
vi.mock("@/lib/api", () => ({
  api: { me: vi.fn() },
}));

const meUser = {
  id: "u1",
  email: "me@test.dev",
  username: "meuser",
  nickname: "Me Nick",
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  permissions: [],
};

function renderUserMenu() {
  const queryClient = new QueryClient();
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delay={0}>
          <SidebarProvider defaultOpen>
            <UserMenu />
          </SidebarProvider>
        </TooltipProvider>
      </QueryClientProvider>
    ),
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/auth/login",
    component: () => null,
  });
  const router = createRouter({ routeTree: rootRoute.addChildren([loginRoute]) });
  return router.load().then(() => render(<RouterProvider router={router} />));
}

describe("UserMenu", () => {
  it("renders the avatar monogram and identity in the footer", async () => {
    (api.me as ReturnType<typeof vi.fn>).mockResolvedValue({ user: meUser });
    await renderUserMenu();
    expect(await screen.findByText("Me Nick")).toBeInTheDocument();
    expect(screen.getByText("me@test.dev")).toBeInTheDocument();
  });

  it("signs out and navigates to /auth/login", async () => {
    (api.me as ReturnType<typeof vi.fn>).mockResolvedValue({ user: meUser });
    await renderUserMenu();
    fireEvent.click(await screen.findByText("Me Nick"));
    const signOut = await screen.findByText("Sign out");
    fireEvent.click(signOut);
    await vi.waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });
});
