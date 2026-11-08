// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MessageRow } from "@/components/messages/MessageRow";
import { useUsersStore } from "@/stores/users";
import type { StoreMessage } from "@/stores/messages";
import "@/i18n";

vi.mock("@/lib/api", () => ({
  api: {
    me: vi.fn(),
    users: { list: vi.fn() },
    posts: { patch: vi.fn(), remove: vi.fn() },
  },
}));

vi.mock("@/ws/client", () => ({
  wsClient: { send: vi.fn() },
}));

import { api } from "@/lib/api";

const message: StoreMessage = {
  id: "msg_1",
  seq: 1,
  userId: "usr_alice",
  parentId: null,
  type: "text",
  content: "hello there",
  attachments: null,
  mentions: null,
  editedAt: null,
  deletedAt: null,
  createdAt: Date.parse("2026-01-01T10:30:00Z"),
};

function renderRow(overrides: Partial<StoreMessage> = {}) {
  const queryClient = new QueryClient();
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <MessageRow message={{ ...message, ...overrides }} channelId="c1" />
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

beforeEach(() => {
  useUsersStore.setState({ byId: {}, pending: {} });
  vi.mocked(api.me).mockResolvedValue({
    user: {
      id: "usr_alice",
      email: "alice@test.dev",
      username: "alice",
      name: "Alice",
      nickname: "Alice",
      avatarUrl: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      permissions: [],
    },
  });
  vi.mocked(api.users.list).mockResolvedValue({
    users: [
      {
        id: "usr_alice",
        username: "alice",
        nickname: "Alice",
        name: "Alice",
        avatarUrl: null,
      },
    ],
  });
});

describe("MessageRow", () => {
  it("renders the author's display name and a timestamp instead of the raw id", async () => {
    await renderRow();
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("usr_alice")).not.toBeInTheDocument();
    expect(screen.getByText("hello there")).toBeInTheDocument();
    expect(document.querySelector("time")).not.toBeNull();
  });

  it("links attachments to the same-origin file routes", async () => {
    await renderRow({
      attachments: [{ fileId: "fil_1", name: "a.png", mime: "image/png" }],
    });
    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("href", "/api/v1/files/fil_1");
    expect(screen.getByRole("img")).toHaveAttribute("src", "/api/v1/files/fil_1/thumbnail");
  });

  it("renders a tombstone for deleted messages", async () => {
    await renderRow({ deletedAt: 123 });
    expect(await screen.findByText("This message was deleted")).toBeInTheDocument();
  });
});
