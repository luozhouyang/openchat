// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen, fireEvent } from "@testing-library/react";
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TeamSwitcher } from "@/components/workspace/TeamSwitcher";
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
    teams: { leave: vi.fn() },
  },
}));

const teams = [
  { id: "t1", displayName: "Team One" },
  { id: "t2", displayName: "Team Two" },
];

function renderSwitcher(currentTeamId: string | null) {
  const queryClient = new QueryClient();
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delay={0}>
          <SidebarProvider defaultOpen>
            <TeamSwitcher teams={teams} currentTeamId={currentTeamId} />
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
  return router.load().then(() => render(<RouterProvider router={router} />));
}

describe("TeamSwitcher", () => {
  it("shows the current team name in the trigger", async () => {
    (api.me as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", email: "a@b.c", permissions: ["create_team"] },
    });
    await renderSwitcher("t1");
    expect(await screen.findByText("Team One")).toBeInTheDocument();
    expect(screen.getByText("Te")).toBeInTheDocument();
  });

  it("shows 'Direct messages' when no team is selected", async () => {
    (api.me as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", email: "a@b.c", permissions: ["create_team"] },
    });
    await renderSwitcher(null);
    expect(await screen.findByText("Direct messages")).toBeInTheDocument();
  });

  it("opens dropdown with all items when permitted", async () => {
    (api.me as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", email: "a@b.c", permissions: ["create_team"] },
    });
    await renderSwitcher("t1");
    fireEvent.click(await screen.findByText("Team One"));
    expect(await screen.findByText("Team Two")).toBeInTheDocument();
    expect(screen.getByText("Create team")).toBeInTheDocument();
    expect(screen.getByText("Team settings")).toBeInTheDocument();
    expect(screen.getByText("Join team")).toBeInTheDocument();
    expect(screen.getByText("Leave team")).toBeInTheDocument();
  });

  it("hides 'Create team' without the permission", async () => {
    (api.me as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", email: "a@b.c", permissions: [] },
    });
    await renderSwitcher("t1");
    fireEvent.click(await screen.findByText("Team One"));
    await screen.findByText("Join team");
    expect(screen.queryByText("Create team")).not.toBeInTheDocument();
  });

  it("calls api.teams.leave and closes the dropdown when leaving", async () => {
    (api.me as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", email: "a@b.c", permissions: ["create_team"] },
    });
    (api.teams.leave as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    await renderSwitcher("t1");
    fireEvent.click(await screen.findByText("Team One"));
    const leaveButton = await screen.findByText("Leave team");
    fireEvent.click(leaveButton);
    expect(api.teams.leave).toHaveBeenCalledWith("t1");
  });
});
