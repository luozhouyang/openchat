import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createHashHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { platform } from "./lib/platform";
import { listenForOpenchatLinks } from "./lib/deep-link";
import "./app.css";

const queryClient = new QueryClient();
// file:// shells (Electron packaged renderer) have no URL rewriting server:
// deep routes cannot resolve, so the router runs on hash history there.
const router = createRouter({
  routeTree,
  history: platform.usesHashRouting ? createHashHistory() : undefined,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

if (!platform.usesHashRouting && "serviceWorker" in navigator) {
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
