import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/lib/api", () => ({
  api: { status: { getMany: vi.fn() } },
}));

import { api } from "@/lib/api";
import { usePresenceStore } from "@/stores/presence";

beforeEach(() => {
  usePresenceStore.setState({ byId: {}, pending: {} });
  vi.mocked(api.status.getMany).mockReset();
});

describe("presence store", () => {
  it("coalesces ensure calls into one batched request", async () => {
    vi.mocked(api.status.getMany).mockResolvedValue({ statuses: { u1: "online", u2: "away" } });
    usePresenceStore.getState().ensure(["u1", "u2", "u1"]);
    await vi.waitFor(() => expect(usePresenceStore.getState().byId.u2?.status).toBe("away"));
    expect(api.status.getMany).toHaveBeenCalledTimes(1);
    const call = vi.mocked(api.status.getMany).mock.calls[0]![0];
    expect([...call.userIds].sort()).toEqual(["u1", "u2"]);
  });

  it("skips fresh entries and refetches stale ones", async () => {
    vi.mocked(api.status.getMany).mockResolvedValue({ statuses: { u1: "dnd" } });
    usePresenceStore.setState({
      byId: { u1: { status: "online", at: Date.now() } },
      pending: {},
    });
    usePresenceStore.getState().ensure(["u1"]);
    expect(api.status.getMany).not.toHaveBeenCalled();

    usePresenceStore.setState({
      byId: { u1: { status: "online", at: Date.now() - 60_000 } },
      pending: {},
    });
    usePresenceStore.getState().ensure(["u1"]);
    await vi.waitFor(() => expect(usePresenceStore.getState().byId.u1?.status).toBe("dnd"));
    expect(api.status.getMany).toHaveBeenCalledTimes(1);
  });
});
