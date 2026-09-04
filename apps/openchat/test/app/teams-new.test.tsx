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
  it("opens a dialog with create and join tabs when permitted, defaulting to create", async () => {
    (api.me as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", email: "a@b.c", permissions: ["create_team"] },
    });
    renderAt("/teams/new");
    expect(await screen.findByText("Create team")).toBeInTheDocument();
    expect(screen.getByText("Join team")).toBeInTheDocument();
    expect(screen.getByLabelText("Identifier (lowercase letters and digits)")).toBeInTheDocument();
  });

  it("hides the create tab and defaults to join without create_team", async () => {
    (api.me as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", email: "a@b.c", permissions: [] },
    });
    renderAt("/teams/new");
    await screen.findByText("Join team");
    expect(screen.queryByText("Create team")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Identifier (lowercase letters and digits)"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Invite code")).toBeInTheDocument();
  });

  it("switches team type with the shadcn select", async () => {
    (api.me as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", email: "a@b.c", permissions: ["create_team"] },
    });
    renderAt("/teams/new");
    await screen.findByLabelText("Identifier (lowercase letters and digits)");
    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveTextContent("Open (anyone can join)");
  });
});
