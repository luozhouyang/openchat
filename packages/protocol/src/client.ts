import type {
  AdminStatsOutput,
  ChannelsForTeamOutput,
  ChannelsListOutput,
  ChannelDetailOutput,
  CompleteUploadOutput,
  CreateChannelInput,
  CreateChannelOutput,
  UpdateChannelInput,
  UpdateChannelOutput,
  CreateInviteOutput,
  CreateTeamInput,
  CreateTeamOutput,
  CreateUploadOutput,
  CreatePostInput,
  DeletePostInput,
  EmailInput,
  JoinByInviteOutput,
  JoinTeamInput,
  ListMembersQuery,
  ListPostsOutput,
  ListPostsQuery,
  MyTeamsOutput,
  NotifyPropsInput,
  NotifyPropsOutput,
  OpenChannelOutput,
  OpenDirectInput,
  OpenGroupInput,
  PatchPostInput,
  PatchTeamInput,
  PermissionsOutput,
  PostOutput,
  PinnedPostsOutput,
  PushSubscribeInput,
  SearchPostsOutput,
  MyThreadsOutput,
  NotificationsOutput,
  UpdateProfileInput,
  UpdateProfileOutput,
  UploadAvatarOutput,
  AddChannelMemberOutput,
  AdminSettingsInput,
  AdminSettingsOutput,
  AuditOutput,
  GlobalSearchOutput,
  PutStatusInput,
  RoleOutput,
  RolesListOutput,
  StatusIdsInput,
  StatusesOutput,
  StatusOutput,
  TeamMembersOutput,
  TeamOutput,
  UploadRequest,
  UserAutocompleteOutput,
  ListUsersOutput,
  AttachUploadOutput,
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
      if (token) {
        headers.set("authorization", `Bearer ${token}`);
      }
    }
    // `credentials` is a DOM spec field not declared by workers-types' narrowed
    // RequestInit (it is harmless-and-ignored on Workers at runtime). Build the
    // options then widen through an assertion so both DOM and Workers tsconfigs
    // accept it without type holes elsewhere.
    const requestInit = {
      credentials: opts.credentials ?? "include",
      ...init,
      headers,
    } as RequestInit;
    const res = await fetch(`${opts.baseUrl ?? ""}${path}`, requestInit);
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
    me: () =>
      f<{
        user: {
          id: string;
          email: string;
          username: string | null;
          name: string | null;
          role: string | null;
          nickname: string | null;
          avatarUrl: string | null;
          createdAt: string;
          permissions: string[];
        };
      }>("/api/v1/users/me"),
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

    users: {
      updateProfile: (input: UpdateProfileInput) =>
        f<UpdateProfileOutput>("/api/v1/users/me", json("PATCH", input)),
      /** Raw image bytes (PNG/JPEG/WebP, max 2 MB). */
      uploadAvatar: (file: Blob) =>
        f<UploadAvatarOutput>("/api/v1/users/me/avatar", {
          method: "POST",
          headers: { "content-type": file.type || "application/octet-stream" },
          body: file,
        }),
      autocomplete: (term: string, limit = 20) =>
        f<UserAutocompleteOutput>(
          `/api/v1/users/autocomplete?term=${encodeURIComponent(term)}&limit=${limit}`,
        ),
      /** Batch profile lookup (max 100 ids) for author names/avatars. */
      list: (ids: string[]) =>
        f<ListUsersOutput>(`/api/v1/users?ids=${encodeURIComponent(ids.slice(0, 100).join(","))}`),
    },

    teams: {
      create: (input: CreateTeamInput) => f<CreateTeamOutput>("/api/v1/teams", json("POST", input)),
      list: () => f<MyTeamsOutput>("/api/v1/users/me/teams"),
      get: (teamId: string) => f<TeamOutput>(`/api/v1/teams/${teamId}`),
      patch: (teamId: string, input: PatchTeamInput) =>
        f<{ ok: true }>(`/api/v1/teams/${teamId}/patch`, json("PUT", input)),
      join: (teamId: string, input: JoinTeamInput) =>
        f<{ ok: true }>(`/api/v1/teams/${teamId}/members`, json("POST", input)),
      joinByInvite: (inviteCode: string) =>
        f<JoinByInviteOutput>("/api/v1/teams/join", json("POST", { inviteCode })),
      listMembers: (teamId: string) => f<TeamMembersOutput>(`/api/v1/teams/${teamId}/members`),
      leave: (teamId: string) =>
        f<{ ok: true }>(`/api/v1/teams/${teamId}/members/me`, { method: "DELETE" }),
    },

    roles: {
      list: () => f<RolesListOutput>("/api/v1/roles"),
      listPermissions: () => f<PermissionsOutput>("/api/v1/permissions"),
      updatePermissions: (roleId: string, permissions: string[]) =>
        f<{ ok: true; role: RoleOutput }>(`/api/v1/roles/${roleId}`, json("PUT", { permissions })),
    },

    channels: {
      create: (input: CreateChannelInput) =>
        f<CreateChannelOutput>("/api/v1/channels", json("POST", input)),
      listByTeam: (teamId: string) => f<ChannelsForTeamOutput>(`/api/v1/teams/${teamId}/channels`),
      get: (channelId: string) => f<ChannelDetailOutput>(`/api/v1/channels/${channelId}`),
      addMember: (channelId: string, userId: string) =>
        f<AddChannelMemberOutput>(`/api/v1/channels/${channelId}/members/${userId}`, {
          method: "POST",
        }),
      update: (channelId: string, input: UpdateChannelInput) =>
        f<UpdateChannelOutput>(`/api/v1/channels/${channelId}`, json("PUT", input)),
      listMembers: (channelId: string, query?: ListMembersQuery) =>
        f<ChannelsListOutput>(
          `/api/v1/channels/${channelId}/members${query ? `?page=${query.page ?? 0}&perPage=${query.perPage ?? 60}` : ""}`,
        ),
      join: (channelId: string) =>
        f<{ ok: true }>(`/api/v1/channels/${channelId}/members`, { method: "POST" }),
      leave: (channelId: string, userId: string) =>
        f<{ ok: true }>(`/api/v1/channels/${channelId}/members/${userId}`, { method: "DELETE" }),
      openDirect: (input: OpenDirectInput) =>
        f<OpenChannelOutput>("/api/v1/channels/direct", json("POST", input)),
      openGroup: (input: OpenGroupInput) =>
        f<OpenChannelOutput>("/api/v1/channels/group", json("POST", input)),
      setNotifyProps: (channelId: string, input: NotifyPropsInput) =>
        f<{ ok: true }>(`/api/v1/channels/${channelId}/members/me/notifyProps`, json("PUT", input)),
      getNotifyProps: (channelId: string) =>
        f<NotifyPropsOutput>(`/api/v1/channels/${channelId}/notifyProps`),
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
      // Pin routes live under POST /api/v1/posts/:id/pin|unpin with the channel
      // in the body (PinPostInput) — the DO broadcast then reaches clients as
      // message.pinned (events.ts).
      pin: (channelId: string, postId: string) =>
        f<{ ok: true }>(`/api/v1/posts/${postId}/pin`, json("POST", { channelId })),
      unpin: (channelId: string, postId: string) =>
        f<{ ok: true }>(`/api/v1/posts/${postId}/unpin`, json("POST", { channelId })),
      listPinned: (channelId: string) =>
        f<PinnedPostsOutput>(`/api/v1/channels/${channelId}/pinned`),
      search: (channelId: string, query: string, limit = 50) =>
        f<SearchPostsOutput>(
          `/api/v1/channels/${channelId}/posts/search?q=${encodeURIComponent(query)}&limit=${limit}`,
        ),
    },

    threads: {
      mine: (teamId: string) => f<MyThreadsOutput>(`/api/v1/users/me/teams/${teamId}/threads`),
    },

    search: {
      global: (query: string, limit = 50) =>
        f<GlobalSearchOutput>(`/api/v1/search?q=${encodeURIComponent(query)}&limit=${limit}`),
    },

    notifications: {
      list: (limit = 50) => f<NotificationsOutput>(`/api/v1/users/me/notifications?limit=${limit}`),
      markRead: (ids?: string[]) =>
        f<{ ok: true }>(
          "/api/v1/users/me/notifications/read",
          json("POST", ids && ids.length > 0 ? { ids } : {}),
        ),
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
      listTeamMembers: (teamId: string) =>
        f<TeamMembersOutput>(`/api/v1/admin/teams/${teamId}/members`),
      setTeamMemberRoles: (teamId: string, userId: string, roles: string[]) =>
        f<{ ok: true }>(
          `/api/v1/admin/teams/${teamId}/members/${userId}/roles`,
          json("PUT", { roles }),
        ),
      patchTeam: (teamId: string, input: PatchTeamInput) =>
        f<{ ok: true }>(`/api/v1/admin/teams/${teamId}/patch`, json("POST", input)),
      inviteEmail: (teamId: string, input: EmailInput) =>
        f<CreateInviteOutput>(`/api/v1/admin/teams/${teamId}/invite/email`, json("POST", input)),
      settings: () => f<AdminSettingsOutput>("/api/v1/admin/settings"),
      setRegistrationMode: (input: AdminSettingsInput) =>
        f<AdminSettingsOutput>("/api/v1/admin/settings", json("PUT", input)),
      audit: (limit = 50, before?: number) =>
        f<AuditOutput>(
          `/api/v1/admin/audit?limit=${limit}${before === undefined ? "" : `&before=${before}`}`,
        ),
    },

    uploads: {
      create: (input: UploadRequest) =>
        f<CreateUploadOutput>("/api/v1/uploads", json("POST", input)),
      complete: (uploadId: string) =>
        f<CompleteUploadOutput>(`/api/v1/uploads/${uploadId}/complete`, json("POST", { uploadId })),
      /** Finish the upload without posting a message; the file is attached later. */
      attach: (uploadId: string) =>
        f<AttachUploadOutput>(`/api/v1/uploads/${uploadId}/attach`, json("POST", { uploadId })),
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
