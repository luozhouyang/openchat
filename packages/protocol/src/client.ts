import type {
  AdminStatsOutput,
  ChannelsForTeamOutput,
  ChannelsListOutput,
  ChannelDetailOutput,
  CompleteUploadOutput,
  CreateChannelInput,
  CreateChannelOutput,
  CreateTeamInput,
  CreateTeamOutput,
  CreateUploadOutput,
  CreatePostInput,
  DeletePostInput,
  JoinTeamInput,
  ListMembersQuery,
  ListPostsOutput,
  ListPostsQuery,
  MyTeamsOutput,
  NotifyPropsInput,
  OpenChannelOutput,
  OpenDirectInput,
  OpenGroupInput,
  PatchPostInput,
  PatchTeamInput,
  PostOutput,
  PushSubscribeInput,
  PutStatusInput,
  StatusIdsInput,
  StatusesOutput,
  StatusOutput,
  TeamOutput,
  UploadRequest,
  WorkspaceResponse,
} from "./rest.ts";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`api ${status}`);
    this.status = status;
    this.body = body;
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

function json(method: string, body?: unknown): RequestInit {
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
    create: (channelId: string, input: CreatePostInput) =>
      apiFetch<PostOutput>(`/api/v1/channels/${channelId}/posts`, json("POST", input)),
    list: (channelId: string, query?: ListPostsQuery) =>
      apiFetch<ListPostsOutput>(
        `/api/v1/channels/${channelId}/posts?limit=${query?.limit ?? 30}${query?.beforeSeq !== undefined ? `&beforeSeq=${query.beforeSeq}` : ""}${query?.parentId ? `&parentId=${query.parentId}` : ""}${query?.order ? `&order=${query.order}` : ""}`,
      ),
    patch: (postId: string, input: PatchPostInput) =>
      apiFetch<{ ok: true }>(`/api/v1/posts/${postId}/patch`, json("PUT", input)),
    remove: (postId: string, input: DeletePostInput) =>
      apiFetch<{ ok: true }>(`/api/v1/posts/${postId}`, json("DELETE", input)),
  },

  push: {
    vapidPublicKey: () => apiFetch<{ publicKey: string }>("/api/v1/users/me/vapid_public_key"),
    subscribe: (input: PushSubscribeInput) =>
      apiFetch<{ ok: true }>("/api/v1/users/me/push_subscriptions", json("POST", input)),
  },

  admin: {
    archiveTeam: (teamId: string) =>
      apiFetch<{ ok: true }>(`/api/v1/admin/teams/${teamId}/archive`, { method: "POST" }),
    archiveChannel: (channelId: string) =>
      apiFetch<{ ok: true }>(`/api/v1/admin/channels/${channelId}/archive`, { method: "POST" }),
    deleteChannel: (channelId: string) =>
      apiFetch<{ ok: true }>(`/api/v1/admin/channels/${channelId}/delete`, { method: "POST" }),
    stats: () => apiFetch<AdminStatsOutput>("/api/v1/admin/stats"),
  },

  uploads: {
    create: (input: UploadRequest) =>
      apiFetch<CreateUploadOutput>("/api/v1/uploads", json("POST", input)),
    complete: (uploadId: string) =>
      apiFetch<CompleteUploadOutput>(
        `/api/v1/uploads/${uploadId}/complete`,
        json("POST", { uploadId }),
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
