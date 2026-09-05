import { api } from "./api";

/**
 * Desktop/notification deep links (spec §4.3): `openchat://c/<channelId>` or
 * `https://<host>/c/<channelId>`. The Electron shell forwards the raw link as
 * a DOM event; here we resolve which team owns the channel and navigate.
 */
export async function handleOpenchatLink(
  navigate: (teamId: string, channelId: string) => Promise<void> | void,
  link: string,
): Promise<void> {
  const match = /\/c\/([^/?#]+)/.exec(link) ?? /openchat:\/\/c\/([^/?#]+)/.exec(link);
  const channelId = match?.[1];
  if (!channelId) {
    return;
  }
  try {
    const workspaces = await api.workspaces();
    for (const team of workspaces.teams) {
      const channel = team.channels.find((c) => c.id === channelId);
      if (channel) {
        await navigate(team.id, channelId);
        return;
      }
    }
  } catch {
    // Not signed in yet / offline: ignore; auth flow will take over.
  }
}

export function listenForOpenchatLinks(
  navigate: (teamId: string, channelId: string) => Promise<void> | void,
): () => void {
  const handler = (event: Event) => {
    const link = (event as CustomEvent<string>).detail;
    if (typeof link === "string") {
      void handleOpenchatLink(navigate, link);
    }
  };
  window.addEventListener("openchat:navigate", handler);
  return () => window.removeEventListener("openchat:navigate", handler);
}
