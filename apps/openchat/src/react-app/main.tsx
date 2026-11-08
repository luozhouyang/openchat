import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { listenForOpenchatLinks } from "./lib/deep-link";
import { queryClient } from "./lib/query-client";
import "./i18n";
import "./app.css";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// The service worker only exists on http(s) deployments (the Electron
// app:// renderer has no push SW).
if (/^https?:$/.test(window.location.protocol) && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
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
