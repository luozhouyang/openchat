// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "@testing-library/react";
import { MentionText } from "@/components/messages/MentionText";
import { applyMention, detectMention, splitMentions } from "@/lib/mentions";
import { useUsersStore } from "@/stores/users";

vi.mock("@/lib/api", () => ({
  api: { users: { list: vi.fn().mockResolvedValue({ users: [] }) } },
}));

describe("mention helpers", () => {
  it("detects an @ token at the caret", () => {
    expect(detectMention("hello @al", 9)).toEqual({ start: 6, query: "al" });
    expect(detectMention("@al", 3)).toEqual({ start: 0, query: "al" });
    expect(detectMention("hello ", 6)).toBeNull();
  });

  it("does not treat mid-word @ or an already-inserted mention as a trigger", () => {
    expect(detectMention("mail a@b", 9)).toBeNull();
    expect(detectMention("hi @[usr_1]", 12)).toBeNull();
  });

  it("replaces the trigger with the canonical @[id] form", () => {
    expect(applyMention("hi @al", 6, 3, "usr_1")).toEqual({
      value: "hi @[usr_1] ",
      caret: 12,
    });
  });

  it("splits text and mention segments", () => {
    expect(splitMentions("hey @[usr_1], ping @[channel]")).toEqual([
      { type: "text", value: "hey " },
      { type: "mention", value: "usr_1" },
      { type: "text", value: ", ping " },
      { type: "mention", value: "channel" },
    ]);
    expect(splitMentions("plain text")).toEqual([{ type: "text", value: "plain text" }]);
  });
});

describe("MentionText", () => {
  beforeEach(() => {
    useUsersStore.setState({
      byId: {
        usr_1: {
          id: "usr_1",
          username: "alice",
          nickname: "Alice",
          name: "Alice",
          avatarUrl: null,
        },
      },
      pending: {},
    });
  });

  it("renders user mentions as display names and keeps broadcast keywords", () => {
    const { container } = render(
      <MentionText content={"hey @[usr_1], ping @[channel] and @[all]"} />,
    );
    expect(container.textContent).toBe("hey @Alice, ping @channel and @all");
  });

  it("falls back to the raw id when the profile is unknown", () => {
    const { container } = render(<MentionText content={"hi @[usr_ghost]"} />);
    expect(container.textContent).toBe("hi @usr_ghost");
  });
});
