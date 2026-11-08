import { QueryClient } from "@tanstack/react-query";

/**
 * One query client for the app; exported so non-React code (the websocket
 * client) can invalidate server-derived caches on realtime events.
 */
export const queryClient = new QueryClient();
