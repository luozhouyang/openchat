// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import type { ChannelSummary } from "protocol";
import { Sidebar } from "@/components/workspace/Sidebar";

function renderSidebar(props: Parameters<typeof Sidebar>[0]) {
  const rootRoute = createRootRoute({
    component: () => (
      <div>
        <Sidebar {...props} />
      </div>
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

describe("Sidebar", () => {
  it("links team channels to /$teamId/c and dms to /dm", async () => {
    await renderSidebar({ title: "Team", channels: [channel], directs: [dm], teamId: "t1" });
    expect(screen.getByRole("link", { name: "# General" })).toHaveAttribute("href", "/t1/c/c1");
    expect(screen.getByRole("link", { name: "Alice" })).toHaveAttribute("href", "/dm/d1");
  });

  it("renders only the DM section when no teamId", async () => {
    await renderSidebar({ title: "私信", channels: [], directs: [dm] });
    expect(screen.getByRole("link", { name: "Alice" })).toHaveAttribute("href", "/dm/d1");
    expect(screen.queryByText("频道")).not.toBeInTheDocument();
  });
});
