// One REST surface for both web modes, constructed by the composition root
// (P12 reviewed decision #3): cookies + relative paths in the browser,
// bearer + injected origin in the Electron file:// shell.
import { appClient } from "@/app-client";

export const api = appClient.api;
export type { WorkspaceResponse } from "protocol";
