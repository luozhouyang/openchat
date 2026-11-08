/**
 * Mention syntax on the wire: `@[<userId>]`, plus the broadcast keywords
 * `@[channel]` and `@[all]`. The server parses exactly this shape
 * (ChannelDO postMessage), so the composer must insert ids, not names.
 */
export const MENTION_RE = /@\[([a-zA-Z0-9_-]+)\]/g;

export const BROADCAST_MENTIONS = new Set(["channel", "all"]);

export interface MentionTrigger {
  /** Index of the "@" in the draft. */
  start: number;
  /** Text typed after "@" so far. */
  query: string;
}

/** Returns the active `@…` token ending at the caret, if any. */
export function detectMention(value: string, caret: number): MentionTrigger | null {
  const before = value.slice(0, caret);
  const match = /(?:^|\s)@([^\s@[]*)$/.exec(before);
  if (!match) {
    return null;
  }
  const query = match[1] ?? "";
  return { start: caret - query.length - 1, query };
}

/** Replaces the active trigger with the canonical `@[id]` mention. */
export function applyMention(
  value: string,
  caret: number,
  start: number,
  userId: string,
): { value: string; caret: number } {
  const inserted = `@[${userId}] `;
  return {
    value: value.slice(0, start) + inserted + value.slice(caret),
    caret: start + inserted.length,
  };
}

/** Splits message content into plain text and mention segments. */
export function splitMentions(
  content: string,
): Array<{ type: "text"; value: string } | { type: "mention"; value: string }> {
  const parts: Array<{ type: "text"; value: string } | { type: "mention"; value: string }> = [];
  let last = 0;
  for (const match of content.matchAll(MENTION_RE)) {
    const start = match.index ?? 0;
    if (start > last) {
      parts.push({ type: "text", value: content.slice(last, start) });
    }
    parts.push({ type: "mention", value: match[1] ?? "" });
    last = start + match[0].length;
  }
  if (last < content.length) {
    parts.push({ type: "text", value: content.slice(last) });
  }
  return parts;
}
