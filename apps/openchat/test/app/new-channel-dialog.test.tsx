// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen, fireEvent } from "@testing-library/react";
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { NewChannelDialog } from "@/components/workspace/NewChannelDialog";
import { useTeamsStore } from "state";
import { api } from "@/lib/api";
import "@/i18n";

vi.mock("@/app-client", () => ({
  appClient: { auth: { hasSession: async () => true } },
}));
vi.mock("@/ws/client", () => ({
  wsClient: { ensureConnected: async () => {}, sendActivity: () => {}, send: () => {} },
}));
vi.mock("@/lib/api", () => ({
  api: { channels: { create: vi.fn() } },
}));

function renderDialog() {
  const queryClient = new QueryClient();
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delay={0}>
          <SidebarProvider defaultOpen>
            <NewChannelDialog teamId="t1" open onOpenChange={() => {}} />
          </SidebarProvider>
        </TooltipProvider>
      </QueryClientProvider>
    ),
  });
  const channelRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/$teamId/c/$channelId",
    component: () => null,
  });
  const router = createRouter({ routeTree: rootRoute.addChildren([channelRoute]) });
  return router.load().then(() => render(<RouterProvider router={router} />));
}

describe("NewChannelDialog", () => {
  it("creates a public channel and adds it to the teams store", async () => {
    (api.channels.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "new-c1" });
    useTeamsStore.setState({
      teams: [{ id: "t1", channels: [] } as never],
      directs: [],
      loaded: true,
    });
    await renderDialog();
    fireEvent.change(screen.getByLabelText("Channel name"), { target: { value: "Random" } });
    fireEvent.click(screen.getByText("Create channel"));
    await vi.waitFor(() =>
      expect(api.channels.create).toHaveBeenCalledWith({
        teamId: "t1",
        displayName: "Random",
        type: "public",
      }),
    );
    await vi.waitFor(() => {
      const team = useTeamsStore.getState().teams.find((tm) => tm.id === "t1");
      expect(team?.channels.some((c) => c.id === "new-c1")).toBe(true);
    });
  });
});
