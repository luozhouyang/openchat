import { useEffect, useMemo } from "react";
import { BROADCAST_MENTIONS, splitMentions } from "@/lib/mentions";
import { displayNameOf, useUsersStore } from "@/stores/users";

/**
 * Renders `@[<id>]` tokens as `@DisplayName` and keeps the surrounding text
 * intact (including newlines, via the caller's whitespace class).
 */
export function MentionText({ content, className }: { content: string; className?: string }) {
  const byId = useUsersStore((s) => s.byId);
  const parts = useMemo(() => splitMentions(content), [content]);
  const ids = useMemo(
    () => [
      ...new Set(
        parts
          .filter((part): part is { type: "mention"; value: string } => part.type === "mention")
          .map((part) => part.value)
          .filter((value) => !BROADCAST_MENTIONS.has(value)),
      ),
    ],
    [parts],
  );

  useEffect(() => {
    if (ids.length > 0) {
      useUsersStore.getState().ensure(ids);
    }
  }, [ids]);

  return (
    <span className={className}>
      {parts.map((part, index) =>
        part.type === "text" ? (
          <span key={index}>{part.value}</span>
        ) : (
          <span key={index} className="rounded bg-primary/10 px-1 font-medium text-primary">
            {`@${
              BROADCAST_MENTIONS.has(part.value)
                ? part.value
                : displayNameOf(byId[part.value], part.value)
            }`}
          </span>
        ),
      )}
    </span>
  );
}
