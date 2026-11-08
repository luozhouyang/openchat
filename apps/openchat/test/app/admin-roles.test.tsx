// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen, fireEvent } from "@testing-library/react";
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
    roles: {
      listPermissions: vi.fn(),
      list: vi.fn(),
      updatePermissions: vi.fn(),
    },
    admin: {
      settings: async () => ({ registrationMode: "open", openRegistration: true }),
      setRegistrationMode: vi.fn(),
      audit: async () => ({ entries: [] }),
    },
    workspaces: async () => ({ teams: [], directs: [] }),
    sidebar: async () => ({ channels: [] }),
  },
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: async () => ({ data: { user: { id: "u1", role: "admin" } }, error: null }),
  },
}));

function renderAdmin() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/admin"] }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("admin roles tab", () => {
  it("lists roles with permission checkboxes and saves", async () => {
    (api.roles.listPermissions as ReturnType<typeof vi.fn>).mockResolvedValue({
      permissions: ["view_team", "create_team"],
    });
    (api.roles.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      roles: [
        {
          id: "r1",
          name: "system_user",
          displayName: "system_user",
          permissions: ["view_team", "create_team"],
          builtIn: true,
        },
      ],
    });
    (api.roles.updatePermissions as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      role: {
        id: "r1",
        name: "system_user",
        displayName: "system_user",
        permissions: [],
        builtIn: true,
      },
    });
    renderAdmin();
    fireEvent.click(await screen.findByRole("tab", { name: "Roles" }));
    expect(await screen.findByText("system_user")).toBeInTheDocument();
    const createBox = screen.getByRole("checkbox", { name: "create_team" });
    expect(createBox).toHaveAttribute("aria-checked", "true");
    fireEvent.click(createBox);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(api.roles.updatePermissions).toHaveBeenCalledWith("r1", ["view_team"]);
  });
});
