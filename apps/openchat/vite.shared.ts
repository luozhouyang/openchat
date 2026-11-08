import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import { fileURLToPath } from "node:url";

// Shared snippets for the three app-level Vite configs (vite.config.ts,
// vite.renderer.config.ts, vitest.config.app.ts). Each returns a fresh plugin
// instance so two configs loaded in the same process (root aggregate runner +
// package runner) never share plugin state. Semantics must stay identical to
// the previous inline definitions — only deduplicated, not changed.

/** `@` → src/react-app, shared by all app-level configs. */
export const reactAppAlias = {
  "@": fileURLToPath(new URL("./src/react-app", import.meta.url)),
};

/** TanStack Router file routes → generated routeTree (fresh instance each call). */
export const tanStackRouterPlugin = (): ReturnType<typeof TanStackRouterVite> =>
  TanStackRouterVite({
    routesDirectory: "./src/react-app/routes",
    generatedRouteTree: "./src/react-app/routeTree.gen.ts",
  });

/** React SPA plugins, without the Cloudflare Worker pieces (fresh instances). */
export const spaPlugins = (): [
  ReturnType<typeof TanStackRouterVite>,
  ReturnType<typeof react>,
  ReturnType<typeof tailwindcss>,
] => [tanStackRouterPlugin(), react(), tailwindcss()];
