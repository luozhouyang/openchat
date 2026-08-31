import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "../src/routeTree.gen";

vi.mock("../src/lib/auth-client", () => ({
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
    expect(await screen.findByText("登录 openchat")).toBeInTheDocument();
  });
});
