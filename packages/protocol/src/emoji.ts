export const ALLOWED_EMOJI = [
  "👍",
  "👎",
  "😄",
  "❤️",
  "🎉",
  "😕",
  "👀",
  "🙏",
  "🔥",
  "✅",
  "❌",
  "😂",
  "😮",
  "😢",
  "🚀",
  "💯",
  "🤔",
  "👏",
  "💪",
  "🙌",
];

export function isAllowedEmoji(emoji: string): boolean {
  return ALLOWED_EMOJI.includes(emoji) && [...emoji].length <= 8;
}
