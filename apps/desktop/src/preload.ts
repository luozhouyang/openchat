import { contextBridge, ipcRenderer } from "electron";

/**
 * Minimal, explicitly-shaped bridge (spec §6.2: contextIsolation, no
 * nodeIntegration, least-privilege preload). The web renderer can use this to
 * raise native notifications and, in the file:// bearer-token mode, reach the
 * safeStorage-backed token store.
 */
const api = {
  notify: (title: string, body: string, link?: string) =>
    ipcRenderer.send("notify", { title, body, link }),
  getToken: (): Promise<string | null> => ipcRenderer.invoke("token:get"),
  setToken: (token: string): Promise<void> => ipcRenderer.invoke("token:set", token),
  clearToken: (): Promise<void> => ipcRenderer.invoke("token:clear"),
  onNavigate: (cb: (link: string) => void) => {
    const handler = (_event: unknown, link: string) => cb(link);
    ipcRenderer.on("navigate", handler);
    return () => ipcRenderer.removeListener("navigate", handler);
  },
};

contextBridge.exposeInMainWorld("openchatDesktop", api);

export type OpenchatDesktopBridge = typeof api;
