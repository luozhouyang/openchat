// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen, fireEvent } from "@testing-library/react";
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { NewDmDialog } from "@/components/workspace/NewDmDialog";
import { api } from "@/lib/api";
import "@/i18n";

vi.mock("@/app-client", () => ({
  appClient: { auth: { hasSession: async () => true } },
}));
vi.mock("@/ws/client", () => ({
  wsClient: { ensureConnected: async () => {}, sendActivity: () => {}, send: () => {} },
}));
vi.mock("@/lib/api", () => ({
  api: {
    me: vi.fn(),
    users: { autocomplete: vi.fn() },
    channels: { openDirect: vi.fn() },
  },
}));

const meUser = {
  id: "u1",
  email: "me@test.dev",
  username: "meuser",
  nickname: null,
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  permissions: [],
};

function renderDm() {
  const queryClient = new QueryClient();
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delay={0}>
          <SidebarProvider defaultOpen>
            <NewDmDialog open onOpenChange={() => {}} />
          </SidebarProvider>
        </TooltipProvider>
      </QueryClientProvider>
    ),
  });
  const dmRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/dm/$channelId",
    component: () => null,
  });
  const router = createRouter({ routeTree: rootRoute.addChildren([dmRoute]) });
  return router.load().then(() => render(<RouterProvider router={router} />));
}

describe("NewDmDialog", () => {
  it("searches people and opens a direct channel", async () => {
    (api.me as ReturnType<typeof vi.fn>).mockResolvedValue({ user: meUser });
    (api.users.autocomplete as ReturnType<typeof vi.fn>).mockResolvedValue({
      users: [{ id: "u2", username: "bob", nickname: "Bob", name: null, avatarUrl: null }],
    });
    (api.channels.openDirect as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "dm-new",
      existing: false,
    });
    await renderDm();
    fireEvent.change(screen.getByPlaceholderText("Search people by name or username"), {
      target: { value: "bob" },
    });
    const bob = await screen.findByText("Bob");
    fireEvent.click(bob);
    await vi.waitFor(() =>
      expect(api.channels.openDirect).toHaveBeenCalledWith({ userIds: ["u1", "u2"] }),
    );
  });
});
