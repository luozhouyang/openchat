import { create } from "zustand";
import type { ChannelSummary, TeamSummary, TeamUpdatePayload, WorkspaceResponse } from "protocol";

export interface StoreTeam extends TeamSummary {
  channels: ChannelSummary[];
}

export const useTeamsStore = create<{
  teams: StoreTeam[];
  directs: ChannelSummary[];
  loaded: boolean;
  loadAll: (data: WorkspaceResponse) => void;
  addChannel: (ch: ChannelSummary) => void;
  patchChannel: (ch: ChannelSummary) => void;
  removeChannel: (channelId: string) => void;
  patchTeam: (team: TeamUpdatePayload) => void;
  addTeam: (team: StoreTeam) => void;
  dropTeam: (teamId: string) => void;
}>((set) => ({
  teams: [],
  directs: [],
  loaded: false,
  loadAll(data) {
    set({ teams: data.teams, directs: data.directs, loaded: true });
  },
  addChannel(ch) {
    set((s) => {
      if (ch.teamId === null) {
        if (s.directs.some((d) => d.id === ch.id)) return s;
        return { directs: [...s.directs, ch] };
      }
      return {
        teams: s.teams.map((t) =>
          t.id === ch.teamId && !t.channels.some((c) => c.id === ch.id)
            ? { ...t, channels: [...t.channels, ch] }
            : t,
        ),
      };
    });
  },
  patchChannel(ch) {
    set((s) => ({
      directs: s.directs.map((d) => (d.id === ch.id ? ch : d)),
      teams: s.teams.map((t) =>
        t.id === ch.teamId
          ? { ...t, channels: t.channels.map((c) => (c.id === ch.id ? ch : c)) }
          : t,
      ),
    }));
  },
  removeChannel(channelId) {
    set((s) => ({
      directs: s.directs.filter((d) => d.id !== channelId),
      teams: s.teams.map((t) => ({ ...t, channels: t.channels.filter((c) => c.id !== channelId) })),
    }));
  },
  patchTeam(team) {
    set((s) => ({
      teams: s.teams.map((t) => (t.id === team.id ? { ...t, ...team } : t)),
    }));
  },
  addTeam(team) {
    set((s) => (s.teams.some((t) => t.id === team.id) ? s : { teams: [...s.teams, team] }));
  },
  dropTeam(teamId) {
    set((s) => ({ teams: s.teams.filter((t) => t.id !== teamId) }));
  },
}));
