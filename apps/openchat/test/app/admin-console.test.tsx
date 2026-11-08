// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
    admin: {
      settings: vi.fn(),
      setRegistrationMode: vi.fn(),
      audit: vi.fn(),
    },
  },
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: async () => ({ data: { user: { id: "u1", role: "admin" } }, error: null }),
    admin: { listUsers: async () => ({ data: { users: [] } }) },
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

/** Wire settings mock so a saved mode is also what the next fetch returns. */
function mockRegistrationMode() {
  let mode: "open" | "invite" | "closed" = "open";
  (api.admin.settings as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
    registrationMode: mode,
    openRegistration: mode === "open",
  }));
  (api.admin.setRegistrationMode as ReturnType<typeof vi.fn>).mockImplementation(
    async (input: { registrationMode: "open" | "invite" | "closed" }) => {
      mode = input.registrationMode;
      return { registrationMode: mode, openRegistration: mode === "open" };
    },
  );
}

describe("admin console", () => {
  it("reflects the fetched registration mode and saves a new mode", async () => {
    mockRegistrationMode();
    renderAdmin();

    const open = await screen.findByRole("button", { name: "Open" });
    const invite = screen.getByRole("button", { name: "Invite only" });
    await waitFor(() => expect(open).toHaveAttribute("aria-pressed", "true"));
    expect(invite).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(invite);

    await waitFor(() =>
      expect(api.admin.setRegistrationMode).toHaveBeenCalledWith({ registrationMode: "invite" }),
    );
    expect(await screen.findByText("Registration mode updated")).toBeInTheDocument();
    await waitFor(() => expect(invite).toHaveAttribute("aria-pressed", "true"));
    expect(open).toHaveAttribute("aria-pressed", "false");
  });

  it("renders audit entries in the audit tab", async () => {
    mockRegistrationMode();
    (api.admin.audit as ReturnType<typeof vi.fn>).mockResolvedValue({
      entries: [
        {
          id: "a1",
          actorId: "u1",
          action: "team.archive",
          target: "t1",
          status: "ok",
          detail: null,
          createdAt: Date.UTC(2026, 0, 2, 3, 4),
        },
      ],
    });
    renderAdmin();

    fireEvent.click(await screen.findByRole("tab", { name: "Audit log" }));

    expect(await screen.findByText("team.archive")).toBeInTheDocument();
    expect(screen.getByText("u1")).toBeInTheDocument();
    expect(screen.getByText("ok")).toBeInTheDocument();
    expect(api.admin.audit).toHaveBeenCalledWith(50);
  });

  it("shows the empty state when the audit log has no entries", async () => {
    mockRegistrationMode();
    (api.admin.audit as ReturnType<typeof vi.fn>).mockResolvedValue({ entries: [] });
    renderAdmin();

    fireEvent.click(await screen.findByRole("tab", { name: "Audit log" }));
    expect(await screen.findByText("No audit entries yet")).toBeInTheDocument();
  });
});
