// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import type { ChannelSummary } from "protocol";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { WorkspaceMenu } from "@/components/workspace/WorkspaceMenu";
import "@/i18n";

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

function renderMenu(props: {
  teamId: string | null;
  channels: ChannelSummary[];
  directs: ChannelSummary[];
}) {
  const rootRoute = createRootRoute({
    component: () => (
      <TooltipProvider delay={0}>
        <SidebarProvider defaultOpen>
          <WorkspaceMenu {...props} />
        </SidebarProvider>
      </TooltipProvider>
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
});
