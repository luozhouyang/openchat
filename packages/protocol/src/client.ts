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
  PermissionsOutput,
  PostOutput,
  PushSubscribeInput,
  PutStatusInput,
  RoleOutput,
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

export interface ApiFetchOptions {
  /** REST base for native clients (web keeps relative paths + cookies). */
  baseUrl?: string;
  /** Bearer token source; when omitted only cookies are sent. */
  getToken?: () => Promise<string | null>;
  /**
   * Cookie mode. Defaults to "include" (browser sessions). Cross-origin
   * bearer clients (Electron file://) should pass "omit": anonymous CORS
   * responses (ACAO *) are rejected for credentialed requests.
   */
  credentials?: "include" | "same-origin" | "omit";
}

/**
 * Cookie-first fetcher with optional bearer injection: web uses the default
 * (relative paths, credentials included), native clients pass baseUrl + a
 * token getter — one auth story across the three clients.
 */
export function createApiFetch(opts: ApiFetchOptions = {}) {
  return async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (opts.getToken) {
      const token = await opts.getToken();
      if (token) headers.set("authorization", `Bearer ${token}`);
    }
    const res = await fetch(`${opts.baseUrl ?? ""}${path}`, {
      credentials: opts.credentials ?? "include",
      ...init,
      headers,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as unknown;
      throw new ApiError(res.status, body);
    }
    return res.json() as Promise<T>;
  };
}

const defaultFetch = createApiFetch();

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return defaultFetch<T>(path, init);
}

function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

/**
 * Full endpoint surface over an injectable fetcher: `api` is the web default
 * (cookies, relative paths); native clients call createApi({ baseUrl,
 * getToken }) to get the same endpoints with bearer auth.
 */
export function createApi(opts: ApiFetchOptions = {}) {
  const f = createApiFetch(opts);
  return {
    me: () => f<{ user: { id: string; email: string; permissions: string[] } }>("/api/v1/users/me"),
    workspaces: () => f<WorkspaceResponse>("/api/v1/users/me/workspaces"),
    sidebar: () =>
      f<{
        channels: Array<{
          channelId: string;
          unread: number;
          mentions: number;
          preview: string | null;
          lastMessageAt: number | null;
        }>;
      }>("/api/v1/users/me/sidebar"),

    teams: {
      create: (input: CreateTeamInput) => f<CreateTeamOutput>("/api/v1/teams", json("POST", input)),
      list: () => f<MyTeamsOutput>("/api/v1/users/me/teams"),
      get: (teamId: string) => f<TeamOutput>(`/api/v1/teams/${teamId}`),
      patch: (teamId: string, input: PatchTeamInput) =>
        f<{ ok: true }>(`/api/v1/teams/${teamId}/patch`, json("PUT", input)),
      join: (teamId: string, input: JoinTeamInput) =>
        f<{ ok: true }>(`/api/v1/teams/${teamId}/members`, json("POST", input)),
    },

    roles: {
      listPermissions: () => f<PermissionsOutput>("/api/v1/permissions"),
      updatePermissions: (roleId: string, permissions: string[]) =>
        f<{ ok: true; role: RoleOutput }>(`/api/v1/roles/${roleId}`, json("PUT", { permissions })),
    },

    channels: {
      create: (input: CreateChannelInput) =>
        f<CreateChannelOutput>("/api/v1/channels", json("POST", input)),
      listByTeam: (teamId: string) => f<ChannelsForTeamOutput>(`/api/v1/teams/${teamId}/channels`),
      get: (channelId: string) => f<ChannelDetailOutput>(`/api/v1/channels/${channelId}`),
      listMembers: (channelId: string, query?: ListMembersQuery) =>
        f<ChannelsListOutput>(
          `/api/v1/channels/${channelId}/members${query ? `?page=${query.page ?? 0}&perPage=${query.perPage ?? 60}` : ""}`,
        ),
      join: (channelId: string) =>
        f<{ ok: true }>(`/api/v1/channels/${channelId}/members`, { method: "POST" }),
      openDirect: (input: OpenDirectInput) =>
        f<OpenChannelOutput>("/api/v1/channels/direct", json("POST", input)),
      openGroup: (input: OpenGroupInput) =>
        f<OpenChannelOutput>("/api/v1/channels/group", json("POST", input)),
      setNotifyProps: (channelId: string, input: NotifyPropsInput) =>
        f<{ ok: true }>(`/api/v1/channels/${channelId}/members/me/notifyProps`, json("PUT", input)),
    },

    posts: {
      create: (channelId: string, input: CreatePostInput) =>
        f<PostOutput>(`/api/v1/channels/${channelId}/posts`, json("POST", input)),
      list: (channelId: string, query?: ListPostsQuery) =>
        f<ListPostsOutput>(
          `/api/v1/channels/${channelId}/posts?limit=${query?.limit ?? 30}${query?.beforeSeq !== undefined ? `&beforeSeq=${query.beforeSeq}` : ""}${query?.parentId ? `&parentId=${query.parentId}` : ""}${query?.order ? `&order=${query.order}` : ""}`,
        ),
      patch: (postId: string, input: PatchPostInput) =>
        f<{ ok: true }>(`/api/v1/posts/${postId}/patch`, json("PUT", input)),
      remove: (postId: string, input: DeletePostInput) =>
        f<{ ok: true }>(`/api/v1/posts/${postId}`, json("DELETE", input)),
    },

    push: {
      vapidPublicKey: () => f<{ publicKey: string }>("/api/v1/users/me/vapid_public_key"),
      subscribe: (input: PushSubscribeInput) =>
        f<{ ok: true }>("/api/v1/users/me/push_subscriptions", json("POST", input)),
    },

    admin: {
      archiveTeam: (teamId: string) =>
        f<{ ok: true }>(`/api/v1/admin/teams/${teamId}/archive`, { method: "POST" }),
      archiveChannel: (channelId: string) =>
        f<{ ok: true }>(`/api/v1/admin/channels/${channelId}/archive`, { method: "POST" }),
      deleteChannel: (channelId: string) =>
        f<{ ok: true }>(`/api/v1/admin/channels/${channelId}/delete`, { method: "POST" }),
      stats: () => f<AdminStatsOutput>("/api/v1/admin/stats"),
    },

    uploads: {
      create: (input: UploadRequest) =>
        f<CreateUploadOutput>("/api/v1/uploads", json("POST", input)),
      complete: (uploadId: string) =>
        f<CompleteUploadOutput>(`/api/v1/uploads/${uploadId}/complete`, json("POST", { uploadId })),
    },

    status: {
      get: (userId: string) => f<StatusOutput>(`/api/v1/users/${userId}/status`),
      put: (userId: string, input: PutStatusInput) =>
        f<{ ok: true }>(`/api/v1/users/${userId}/status`, json("PUT", input)),
      getMany: (input: StatusIdsInput) =>
        f<StatusesOutput>("/api/v1/users/status/ids", json("POST", input)),
    },
  };
}

export const api = createApi();
