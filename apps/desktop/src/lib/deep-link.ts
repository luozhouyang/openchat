/**
 * Notification deep-link parser (spec §4.3): tray/notification clicks carry
 * `openchat://c/<channelId>` links; the shell forwards them into the web
 * renderer which resolves the channel's team and navigates.
 */

export interface OpenchatLink {
  channelId: string;
}

export function parseOpenchatLink(raw: string): OpenchatLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol === "openchat:") {
    // openchat://c/<channelId>
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.host === "c" && parts.length === 1) {
      return { channelId: parts[0] };
    }
    if (parts.length === 2 && parts[0] === "c") {
      return { channelId: parts[1] };
    }
    return null;
  }
  if (url.protocol === "http:" || url.protocol === "https:") {
    const match = /\/c\/([^/]+)/.exec(url.pathname);
    return match ? { channelId: match[1] } : null;
  }
  return null;
}
