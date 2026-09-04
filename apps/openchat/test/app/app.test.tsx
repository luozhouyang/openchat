// @vitest-environment jsdom
// Component test (DOM rendering via @testing-library/react); declares jsdom
// and pulls in the jest-dom matchers itself so it also works under the root
// aggregate runner (which does not load the web package's setup file).
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { createMemoryDatabase } from "state";
import { routeTree } from "@/routeTree.gen";
import { hydrateChannel } from "@/lib/message-db";
import { useMessageStore } from "@/stores/messages";

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: vi.fn().mockResolvedValue({
      data: { user: { id: "u1", email: "a@b.c" }, session: { id: "s1" } },
      error: null,
    }),
  },
}));

const router = createRouter({ routeTree });

describe("app", () => {
  it("redirects an authenticated user without workspaces to login", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Sign in to openchat")).toBeInTheDocument();
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
