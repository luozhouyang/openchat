import type {
  ChannelsForTeamOutput,
  ChannelsListOutput,
  ChannelDetailOutput,
  CreateChannelInput,
  CreateChannelOutput,
  CreateTeamInput,
  CreateTeamOutput,
  JoinTeamInput,
  ListMembersQuery,
  ListPostsOutput,
  ListPostsQuery,
  MyTeamsOutput,
  NotifyPropsInput,
  OpenChannelOutput,
  OpenDirectInput,
  OpenGroupInput,
  PatchTeamInput,
  PutStatusInput,
  StatusIdsInput,
  StatusesOutput,
  StatusOutput,
  TeamOutput,
  WorkspaceResponse,
} from "./rest.ts";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`api ${status}`);
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as unknown;
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<T>;
}

function json<T>(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export const api = {
  me: () => apiFetch<{ user: { id: string; email: string } }>("/api/v1/users/me"),
  workspaces: () => apiFetch<WorkspaceResponse>("/api/v1/users/me/workspaces"),
  sidebar: () =>
    apiFetch<{
      channels: Array<{
        channelId: string;
        unread: number;
        mentions: number;
        preview: string | null;
        lastMessageAt: number | null;
      }>;
    }>("/api/v1/users/me/sidebar"),

  teams: {
    create: (input: CreateTeamInput) =>
      apiFetch<CreateTeamOutput>("/api/v1/teams", json("POST", input)),
    list: () => apiFetch<MyTeamsOutput>("/api/v1/users/me/teams"),
    get: (teamId: string) => apiFetch<TeamOutput>(`/api/v1/teams/${teamId}`),
    patch: (teamId: string, input: PatchTeamInput) =>
      apiFetch<{ ok: true }>(`/api/v1/teams/${teamId}/patch`, json("PUT", input)),
    join: (teamId: string, input: JoinTeamInput) =>
      apiFetch<{ ok: true }>(`/api/v1/teams/${teamId}/members`, json("POST", input)),
  },

  channels: {
    create: (input: CreateChannelInput) =>
      apiFetch<CreateChannelOutput>("/api/v1/channels", json("POST", input)),
    listByTeam: (teamId: string) =>
      apiFetch<ChannelsForTeamOutput>(`/api/v1/teams/${teamId}/channels`),
    get: (channelId: string) => apiFetch<ChannelDetailOutput>(`/api/v1/channels/${channelId}`),
    listMembers: (channelId: string, query?: ListMembersQuery) =>
      apiFetch<ChannelsListOutput>(
        `/api/v1/channels/${channelId}/members${query ? `?page=${query.page ?? 0}&perPage=${query.perPage ?? 60}` : ""}`,
      ),
    join: (channelId: string) =>
      apiFetch<{ ok: true }>(`/api/v1/channels/${channelId}/members`, { method: "POST" }),
    openDirect: (input: OpenDirectInput) =>
      apiFetch<OpenChannelOutput>("/api/v1/channels/direct", json("POST", input)),
    openGroup: (input: OpenGroupInput) =>
      apiFetch<OpenChannelOutput>("/api/v1/channels/group", json("POST", input)),
    setNotifyProps: (channelId: string, input: NotifyPropsInput) =>
      apiFetch<{ ok: true }>(
        `/api/v1/channels/${channelId}/members/me/notifyProps`,
        json("PUT", input),
      ),
  },

  posts: {
    list: (channelId: string, query?: ListPostsQuery) =>
      apiFetch<ListPostsOutput>(
        `/api/v1/channels/${channelId}/posts?limit=${query?.limit ?? 30}${query?.beforeSeq !== undefined ? `&beforeSeq=${query.beforeSeq}` : ""}${query?.parentId ? `&parentId=${query.parentId}` : ""}${query?.order ? `&order=${query.order}` : ""}`,
      ),
  },

  status: {
    get: (userId: string) => apiFetch<StatusOutput>(`/api/v1/users/${userId}/status`),
    put: (userId: string, input: PutStatusInput) =>
      apiFetch<{ ok: true }>(`/api/v1/users/${userId}/status`, json("PUT", input)),
    getMany: (input: StatusIdsInput) =>
      apiFetch<StatusesOutput>("/api/v1/users/status/ids", json("POST", input)),
  },
};
