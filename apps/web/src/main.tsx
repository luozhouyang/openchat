import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { listenForOpenchatLinks } from "./lib/deep-link";
import "./app.css";

const queryClient = new QueryClient();
const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js");
}

// Electron shell / notification deep links (openchat://c/<channelId>).
listenForOpenchatLinks((teamId, channelId) =>
  router.navigate({ to: "/$teamId/c/$channelId", params: { teamId, channelId } }),
);

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
