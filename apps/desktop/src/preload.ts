import { contextBridge, ipcRenderer } from "electron";

/**
 * Minimal, explicitly-shaped bridge (spec §6.2: contextIsolation, no
 * nodeIntegration, least-privilege preload). The web renderer uses this to
 * raise native notifications and, in the file:// bearer-token mode, reach the
 * safeStorage-backed token store and the injected API origin. Deep links
 * arrive as the DOM event "openchat:navigate" dispatched by the main process
 * (see main.ts), not via this bridge.
 */
function injectedApiUrl(): string {
  const arg = process.argv.find((a) => a.startsWith("--openchat-api="));
  return arg ? arg.slice("--openchat-api=".length) : "";
}

const api = {
  notify: (title: string, body: string, link?: string) =>
    ipcRenderer.send("notify", { title, body, link }),
  getToken: (): Promise<string | null> => ipcRenderer.invoke("token:get"),
  setToken: (token: string): Promise<void> => ipcRenderer.invoke("token:set", token),
  clearToken: (): Promise<void> => ipcRenderer.invoke("token:clear"),
  serverUrl: injectedApiUrl(),
};

contextBridge.exposeInMainWorld("openchatDesktop", api);

export type OpenchatDesktopBridge = typeof api;
