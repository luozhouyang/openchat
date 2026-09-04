// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter, createMemoryHistory } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";
import { api } from "@/lib/api";

vi.mock("@/app-client", () => ({
  appClient: { auth: { hasSession: async () => true } },
}));
vi.mock("@/ws/client", () => ({
  wsClient: { ensureConnected: async () => {}, sendActivity: () => {}, send: () => {} },
}));
vi.mock("@/lib/api", () => ({
  api: {
    me: vi.fn(),
    teams: { create: vi.fn(), joinByInvite: vi.fn() },
    workspaces: async () => ({ teams: [], directs: [] }),
    sidebar: async () => ({ channels: [] }),
  },
}));

function renderAt(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("/teams/new", () => {
  it("shows create and join tabs when permitted", async () => {
    (api.me as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", email: "a@b.c", permissions: ["create_team"] },
    });
    renderAt("/teams/new");
    expect(await screen.findByText("创建团队")).toBeInTheDocument();
    expect(screen.getByText("加入团队")).toBeInTheDocument();
  });

  it("hides the create tab without create_team permission", async () => {
    (api.me as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", email: "a@b.c", permissions: [] },
    });
    renderAt("/teams/new");
    await screen.findByText("加入团队");
    expect(screen.queryByText("创建团队")).not.toBeInTheDocument();
  });
});
