import { describe, expect, it } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "../src/routeTree.gen";

const router = createRouter({ routeTree });

describe("app", () => {
  it("renders the root route", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("openchat")).toBeInTheDocument();
  });
});
