// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen, fireEvent } from "@testing-library/react";
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ChannelSummary } from "protocol";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { WorkspaceMenu } from "@/components/workspace/WorkspaceMenu";
import { api } from "@/lib/api";
import "@/i18n";

vi.mock("@/app-client", () => ({
  appClient: { auth: { hasSession: async () => true } },
}));
vi.mock("@/ws/client", () => ({
  wsClient: { ensureConnected: async () => {}, sendActivity: () => {}, send: () => {} },
}));
vi.mock("@/lib/api", () => ({
  api: { me: vi.fn() },
}));

const channel: ChannelSummary = {
  id: "c1",
  teamId: "t1",
  name: "general",
  displayName: "General",
  type: "public",
  member: true,
  archivedAt: null,
};
const dm: ChannelSummary = {
  id: "d1",
  teamId: null,
  name: null,
  displayName: "Alice",
  type: "dm",
  member: true,
  archivedAt: null,
};
const meUser = {
  id: "u1",
  email: "me@test.dev",
  username: "meuser",
  nickname: null,
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  permissions: [],
};

function renderMenu(props: {
  teamId: string | null;
  channels: ChannelSummary[];
  directs: ChannelSummary[];
}) {
  const queryClient = new QueryClient();
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delay={0}>
          <SidebarProvider defaultOpen>
            <WorkspaceMenu {...props} />
          </SidebarProvider>
        </TooltipProvider>
      </QueryClientProvider>
    ),
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => null,
  });
  const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]) });
  return router.load().then(() => {
    (api.me as ReturnType<typeof vi.fn>).mockResolvedValue({ user: meUser });
    return render(<RouterProvider router={router} />);
  });
}

describe("WorkspaceMenu", () => {
  it("links team channels to /$teamId/c and dms to /dm", async () => {
    await renderMenu({ teamId: "t1", channels: [channel], directs: [dm] });
    expect(screen.getByRole("link", { name: "General" })).toHaveAttribute("href", "/t1/c/c1");
    expect(screen.getByRole("link", { name: "Alice" })).toHaveAttribute("href", "/dm/d1");
  });

  it("renders only the direct-messages group when no teamId", async () => {
    await renderMenu({ teamId: null, channels: [], directs: [dm] });
    expect(screen.getByRole("link", { name: "Alice" })).toHaveAttribute("href", "/dm/d1");
    expect(screen.queryByText("Channels")).not.toBeInTheDocument();
    expect(screen.getByText("Direct messages")).toBeInTheDocument();
  });

  it("opens the new-channel dialog from the Channels group action", async () => {
    await renderMenu({ teamId: "t1", channels: [], directs: [] });
    fireEvent.click(screen.getByRole("button", { name: "New channel" }));
    expect(screen.getByText("Channel name")).toBeInTheDocument();
  });
});
