// @vitest-environment jsdom
// Routing tests for the workspace-less landing: an authenticated user without
// teams is routed to /dm, with teams to the first team. Network is stubbed.
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter, createMemoryHistory } from "@tanstack/react-router";
import { createMemoryDatabase } from "state";
import { routeTree } from "@/routeTree.gen";
import { hydrateChannel } from "@/lib/message-db";
import { useMessageStore } from "@/stores/messages";
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
    workspaces: vi.fn(),
    sidebar: async () => ({ channels: [] }),
  },
}));

function renderApp() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("root redirect", () => {
  it("routes a teamless authenticated user to /dm and shows the empty state", async () => {
    (api.workspaces as ReturnType<typeof vi.fn>).mockResolvedValue({ teams: [], directs: [] });
    renderApp();
    expect(
      await screen.findByText(
        "No conversations yet. Join a team or start a direct message to begin chatting.",
      ),
    ).toBeInTheDocument();
    expect(await screen.findAllByRole("link", { name: "Create team" })).toHaveLength(1);
    expect(await screen.findByRole("link", { name: "Join team" })).toBeInTheDocument();
  });

  it("routes to the first team when the user has teams", async () => {
    (api.workspaces as ReturnType<typeof vi.fn>).mockResolvedValue({
      teams: [
        {
          id: "t1",
          name: "t1",
          displayName: "T1",
          type: "open",
          roles: "team_admin",
          archivedAt: null,
          channels: [],
        },
      ],
      directs: [],
    });
    renderApp();
    expect(await screen.findByText("尚未加入任何频道")).toBeInTheDocument();
  });

  it("renders the dm home with resolved direct display names", async () => {
    (api.workspaces as ReturnType<typeof vi.fn>).mockResolvedValue({
      teams: [],
      directs: [
        {
          id: "d1",
          teamId: null,
          name: null,
          displayName: "Alice",
          type: "dm",
          member: true,
          archivedAt: null,
        },
      ],
    });
    renderApp();
    const links = await screen.findAllByRole("link", { name: "Alice" });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/dm/d1");
    }
  });
});

describe("channel view hydration", () => {
  it("seeds the message store from the local db before sync", async () => {
    const db = createMemoryDatabase();
    await db.migrate();
    await db.messages.append("c1", {
      id: "m1",
      seq: 1,
      userId: "u1",
      type: "text",
      content: "cached",
      createdAt: 1,
      parentId: null,
      attachments: null,
      mentions: null,
      editedAt: null,
      deletedAt: null,
    });
    useMessageStore.getState().reset("c1");
    const n = await hydrateChannel("c1", db);
    expect(n).toBe(1);
    expect(useMessageStore.getState().list("c1")[0].content).toBe("cached");
    expect(useMessageStore.getState().maxSeq("c1")).toBe(1);
  });
});
