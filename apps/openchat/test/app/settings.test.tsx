// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter, createMemoryHistory } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";
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
    me: async () => ({ user: { id: "u1", email: "a@b.c", permissions: ["create_team"] } }),
    teams: {
      listMembers: vi.fn(),
      patch: vi.fn(),
      leave: vi.fn(),
    },
    workspaces: async () => ({
      teams: [
        {
          id: "t1",
          name: "t1",
          displayName: "Team One",
          type: "open",
          roles: "team_admin",
          archivedAt: null,
          channels: [],
        },
      ],
      directs: [],
    }),
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

describe("/$teamId/settings", () => {
  it("renders team info form and member list", async () => {
    (api.teams.listMembers as ReturnType<typeof vi.fn>).mockResolvedValue({
      members: [
        { userId: "u1", roles: "team_admin" },
        { userId: "u2", roles: "team_user" },
      ],
    });
    renderAt("/t1/settings");
    expect(await screen.findByText("Team settings")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Team One")).toBeInTheDocument();
    expect(await screen.findByText("u2")).toBeInTheDocument();
  });
});
