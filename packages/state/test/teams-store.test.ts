import { expect, test } from "vite-plus/test";
import type { WorkspaceResponse } from "protocol";
import { useTeamsStore } from "../src/stores/teams.ts";

const ws = (teams: WorkspaceResponse["teams"], directs = []): WorkspaceResponse => ({
  teams,
  directs,
});
const team1 = {
  id: "t1",
  name: "acme",
  displayName: "Acme",
  type: "open" as const,
  roles: "team_admin",
  archivedAt: null,
  channels: [] as WorkspaceResponse["teams"][number]["channels"],
};
const ch = {
  id: "c1",
  teamId: "t1",
  name: "general",
  displayName: "General",
  type: "public" as const,
  member: true,
  archivedAt: null,
};

test("loadAll seeds teams and directs", () => {
  useTeamsStore.getState().loadAll(ws([{ ...team1, channels: [ch] }]));
  expect(useTeamsStore.getState().loaded).toBe(true);
  expect(useTeamsStore.getState().teams[0].channels).toHaveLength(1);
});

test("addChannel appends to its team, patchChannel replaces, removeChannel drops", () => {
  useTeamsStore.getState().loadAll(ws([team1]));
  useTeamsStore.getState().addChannel(ch);
  expect(useTeamsStore.getState().teams[0].channels).toHaveLength(1);
  useTeamsStore.getState().patchChannel({ ...ch, displayName: "Renamed" });
  expect(useTeamsStore.getState().teams[0].channels[0].displayName).toBe("Renamed");
  useTeamsStore.getState().removeChannel("c1");
  expect(useTeamsStore.getState().teams[0].channels).toHaveLength(0);
});

test("teamId-null channels go to directs", () => {
  useTeamsStore.getState().loadAll(ws([team1]));
  const dm = { ...ch, id: "d1", teamId: null, type: "dm" as const };
  useTeamsStore.getState().addChannel(dm);
  expect(useTeamsStore.getState().directs.map((d) => d.id)).toContain("d1");
  useTeamsStore.getState().removeChannel("d1");
  expect(useTeamsStore.getState().directs).toHaveLength(0);
});

test("patchTeam updates fields, addTeam is idempotent, dropTeam removes", () => {
  useTeamsStore.getState().loadAll(ws([team1]));
  useTeamsStore
    .getState()
    .patchTeam({ id: "t1", name: "acme", displayName: "Acme 2", type: "open", archivedAt: 123 });
  expect(useTeamsStore.getState().teams[0].displayName).toBe("Acme 2");
  expect(useTeamsStore.getState().teams[0].archivedAt).toBe(123);
  expect(useTeamsStore.getState().teams[0].roles).toBe("team_admin");
  useTeamsStore.getState().addTeam({ ...team1, id: "t2", channels: [] });
  expect(useTeamsStore.getState().teams).toHaveLength(2);
  useTeamsStore.getState().addTeam({ ...team1, id: "t2", channels: [] });
  expect(useTeamsStore.getState().teams).toHaveLength(2);
  useTeamsStore.getState().dropTeam("t2");
  expect(useTeamsStore.getState().teams).toHaveLength(1);
});
