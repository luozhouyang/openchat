import { describe, expect, it } from "vite-plus/test";
import { parseOpenchatLink } from "../src/lib/deep-link";

describe("deep-link parser", () => {
  it("parses openchat://c/<channelId>", () => {
    expect(parseOpenchatLink("openchat://c/chn_123")).toEqual({ channelId: "chn_123" });
  });

  it("parses openchat://c/ form with leading path", () => {
    expect(parseOpenchatLink("openchat://openchat.dev/c/chn_123")).toEqual({
      channelId: "chn_123",
    });
  });

  it("parses https channel links", () => {
    expect(parseOpenchatLink("https://chat.openchat.dev/t1/c/chn_9?x=1")).toEqual({
      channelId: "chn_9",
    });
  });

  it("rejects unrelated urls and garbage", () => {
    expect(parseOpenchatLink("openchat://settings")).toBeNull();
    expect(parseOpenchatLink("https://chat.openchat.dev/")).toBeNull();
    expect(parseOpenchatLink("not a url")).toBeNull();
  });
});
