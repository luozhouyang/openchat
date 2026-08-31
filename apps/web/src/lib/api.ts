import type { WorkspaceResponse } from "protocol";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`api ${status}`);
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return res.json() as Promise<T>;
}

export const api = {
  me: () => apiFetch<{ user: { id: string; email: string } }>("/me"),
  workspaces: () => apiFetch<WorkspaceResponse>("/me/workspaces"),
  sidebar: () =>
    apiFetch<{
      channels: Array<{
        channelId: string;
        unread: number;
        mentions: number;
        preview: string | null;
        lastMessageAt: number | null;
      }>;
    }>("/me/sidebar"),
};
