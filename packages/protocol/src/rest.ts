import { z } from "zod";
import {
  ChannelTypeSchema,
  TeamTypeSchema,
  MessageTypeSchema,
  NotifPrefSchema,
  PushKindSchema,
  UserStatusSchema,
  SortOrderSchema,
  RoleNameSchema,
} from "./enums.ts";

export const slugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
export const idSchema = z.string().min(1);
export const emailSchema = z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
const displayNameSchema = z.string().min(1).max(128);

// ---- teams ----
export const CreateTeamInput = z.object({
  name: slugSchema,
  displayName: displayNameSchema,
  type: TeamTypeSchema.default("open"),
  description: z.string().max(1024).optional(),
});
export type CreateTeamInput = z.infer<typeof CreateTeamInput>;
export const CreateTeamOutput = z.object({
  id: idSchema,
  inviteCode: z.string().optional(),
});
export type CreateTeamOutput = z.infer<typeof CreateTeamOutput>;

export const PatchTeamInput = z.object({
  displayName: displayNameSchema.optional(),
  description: z.string().max(1024).optional(),
  archived: z.boolean().optional(),
});
export type PatchTeamInput = z.infer<typeof PatchTeamInput>;

export const JoinTeamInput = z.object({ inviteCode: z.string().max(128).optional() });
export type JoinTeamInput = z.infer<typeof JoinTeamInput>;
export const JoinByInviteInput = z.object({ inviteCode: z.string().min(1).max(128) });
export type JoinByInviteInput = z.infer<typeof JoinByInviteInput>;
export const JoinByInviteOutput = z.object({ teamId: idSchema });
export type JoinByInviteOutput = z.infer<typeof JoinByInviteOutput>;
export const TeamMemberOutput = z.object({ userId: idSchema, roles: z.string() });
export type TeamMemberOutput = z.infer<typeof TeamMemberOutput>;
export const TeamMembersOutput = z.object({ members: z.array(TeamMemberOutput) });
export type TeamMembersOutput = z.infer<typeof TeamMembersOutput>;

export const TeamSummary = z.object({
  id: idSchema,
  name: z.string(),
  displayName: z.string(),
  type: TeamTypeSchema,
  roles: z.string(),
  archivedAt: z.number().nullable(),
});
export type TeamSummary = z.infer<typeof TeamSummary>;
export const MyTeamsOutput = z.object({ teams: z.array(TeamSummary) });
export type MyTeamsOutput = z.infer<typeof MyTeamsOutput>;
export const TeamOutput = z.object({ team: TeamSummary });
export type TeamOutput = z.infer<typeof TeamOutput>;

// ---- channels ----
export const CreateChannelInput = z.object({
  teamId: idSchema,
  name: slugSchema.optional(),
  displayName: displayNameSchema,
  type: z.enum(["public", "private"]),
  purpose: z.string().max(500).optional(),
  header: z.string().max(1024).optional(),
});
export type CreateChannelInput = z.infer<typeof CreateChannelInput>;
export const CreateChannelOutput = z.object({ id: idSchema });
export type CreateChannelOutput = z.infer<typeof CreateChannelOutput>;

export const OpenDirectInput = z.object({ userIds: z.array(idSchema).length(2) });
export type OpenDirectInput = z.infer<typeof OpenDirectInput>;
export const OpenGroupInput = z.object({ userIds: z.array(idSchema).min(2).max(8) });
export type OpenGroupInput = z.infer<typeof OpenGroupInput>;
export const OpenChannelOutput = z.object({ id: idSchema, existing: z.boolean() });
export type OpenChannelOutput = z.infer<typeof OpenChannelOutput>;

export const ChannelSummary = z.object({
  id: idSchema,
  teamId: z.string().nullable(),
  name: z.string().nullable(),
  displayName: z.string(),
  type: ChannelTypeSchema,
  member: z.boolean(),
  archivedAt: z.number().nullable(),
  /** Direct/group channels only: participants, for presence and naming. */
  memberIds: z.array(idSchema).optional(),
});
export type ChannelSummary = z.infer<typeof ChannelSummary>;
export const ChannelsForTeamOutput = z.object({ channels: z.array(ChannelSummary) });
export type ChannelsForTeamOutput = z.infer<typeof ChannelsForTeamOutput>;

export const ChannelDetail = z.object({
  id: idSchema,
  teamId: z.string().nullable(),
  /** Caller's channel role; drives member-management affordances. */
  callerRole: z.enum(["admin", "member"]).optional(),
  displayName: z.string(),
  type: ChannelTypeSchema,
  purpose: z.string().nullable(),
  header: z.string().nullable(),
  memberCount: z.number(),
  archivedAt: z.number().nullable(),
});
export type ChannelDetail = z.infer<typeof ChannelDetail>;
export const ChannelDetailOutput = z.object({ channel: ChannelDetail });
export type ChannelDetailOutput = z.infer<typeof ChannelDetailOutput>;
export const UpdateChannelInput = z.object({
  displayName: displayNameSchema.optional(),
  purpose: z.string().max(1024).nullable().optional(),
  header: z.string().max(1024).nullable().optional(),
});
export type UpdateChannelInput = z.infer<typeof UpdateChannelInput>;
export const UpdateChannelOutput = z.object({ channel: ChannelSummary });
export type UpdateChannelOutput = z.infer<typeof UpdateChannelOutput>;

export const ListMembersQuery = z.object({
  page: z.coerce.number().int().nonnegative().optional(),
  perPage: z.coerce.number().int().positive().max(200).optional(),
});
export type ListMembersQuery = z.infer<typeof ListMembersQuery>;
export const ChannelsListOutput = z.object({ memberIds: z.array(idSchema) });
export type ChannelsListOutput = z.infer<typeof ChannelsListOutput>;

export const UpdateProfileInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  nickname: z.string().trim().max(80).nullable().optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;
export const UpdateProfileOutput = z.object({ ok: z.boolean() });
export type UpdateProfileOutput = z.infer<typeof UpdateProfileOutput>;

export const UploadAvatarOutput = z.object({ avatarUrl: z.string() });
export type UploadAvatarOutput = z.infer<typeof UploadAvatarOutput>;

export const AddChannelMemberOutput = z.object({ ok: z.boolean() });
export type AddChannelMemberOutput = z.infer<typeof AddChannelMemberOutput>;

export const NotifyPropsInput = z.object({
  notifyProps: z.object({ pref: NotifPrefSchema }),
});
export type NotifyPropsInput = z.infer<typeof NotifyPropsInput>;
export const NotifyPropsOutput = NotifyPropsInput;
export type NotifyPropsOutput = z.infer<typeof NotifyPropsOutput>;

// ---- posts ----
/**
 * Attachment descriptor as stored on the message row (ChannelDO writes the
 * upload session's fileId/key/name/size/mime verbatim). Loose on purpose:
 * the thumbnail pipeline may add fields without a protocol bump.
 */
export const PostAttachment = z
  .object({
    fileId: idSchema,
    key: z.string().optional(),
    name: z.string().optional(),
    mime: z.string().optional(),
    size: z.number().optional(),
    thumbUrl: z.string().optional(),
  })
  .passthrough();
export type PostAttachment = z.infer<typeof PostAttachment>;

/** Response of the draft-upload endpoint: attach now, post later. */
export const AttachUploadOutput = z.object({ attachment: PostAttachment });
export type AttachUploadOutput = z.infer<typeof AttachUploadOutput>;

export const CreatePostInput = z
  .object({
    // Empty only when the post carries attachments (file-only messages).
    message: z.string().max(16384),
    parentId: idSchema.optional(),
    clientToken: z.string().min(1).max(64).optional(),
    /** Attach already-uploaded files to this post (max 10 per message). */
    attachments: z.array(PostAttachment).max(10).optional(),
  })
  .refine((v) => v.message.trim().length > 0 || (v.attachments?.length ?? 0) > 0, {
    message: "message or attachments required",
  });
export type CreatePostInput = z.infer<typeof CreatePostInput>;

export const PatchPostInput = z.object({
  message: z.string().min(1).max(16384),
  channelId: idSchema,
});
export type PatchPostInput = z.infer<typeof PatchPostInput>;

export const DeletePostInput = z.object({ channelId: idSchema });
export type DeletePostInput = z.infer<typeof DeletePostInput>;

export const PinPostInput = z.object({ channelId: idSchema });
export type PinPostInput = z.infer<typeof PinPostInput>;

export const ListPostsQuery = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  beforeSeq: z.coerce.number().int().nonnegative().optional(),
  parentId: idSchema.optional(),
  order: SortOrderSchema.optional(),
});
export type ListPostsQuery = z.infer<typeof ListPostsQuery>;

export const PostOutput = z.object({
  id: idSchema,
  seq: z.number(),
  userId: idSchema,
  parentId: z.string().nullable(),
  type: MessageTypeSchema,
  content: z.string(),
  /** Present on file messages and any post created with attachments. */
  attachments: z.array(PostAttachment).nullable().optional(),
  mentions: z.array(z.string()).nullable(),
  editedAt: z.number().nullable(),
  deletedAt: z.number().nullable(),
  createdAt: z.number(),
  /** Mirrors HistoryMessage/DO rowToMessage (`isPinned` column is NOT NULL default false). */
  isPinned: z.boolean(),
});
export type PostOutput = z.infer<typeof PostOutput>;
export const ListPostsOutput = z.object({
  messages: z.array(PostOutput),
  oldestSeq: z.number().nullable(),
});
export const PinnedPostsOutput = z.object({ messages: z.array(PostOutput) });
export type PinnedPostsOutput = z.infer<typeof PinnedPostsOutput>;
export const SearchPostsQuery = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export type SearchPostsQuery = z.infer<typeof SearchPostsQuery>;
export const SearchPostsOutput = z.object({ messages: z.array(PostOutput) });
export type SearchPostsOutput = z.infer<typeof SearchPostsOutput>;
export const GlobalSearchQuery = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export type GlobalSearchQuery = z.infer<typeof GlobalSearchQuery>;
export const GlobalSearchHit = z.object({
  message: PostOutput,
  channel: ChannelSummary,
});
export type GlobalSearchHit = z.infer<typeof GlobalSearchHit>;
export const GlobalSearchOutput = z.object({ hits: z.array(GlobalSearchHit) });
export type GlobalSearchOutput = z.infer<typeof GlobalSearchOutput>;
export type ListPostsOutput = z.infer<typeof ListPostsOutput>;

// ---- threads ----
export const ThreadReadInput = z.object({ channelId: idSchema });
export type ThreadReadInput = z.infer<typeof ThreadReadInput>;
export const ThreadFollowInput = z.object({ channelId: idSchema, state: z.boolean() });
export type ThreadFollowInput = z.infer<typeof ThreadFollowInput>;
export const ThreadQuery = z.object({ channelId: idSchema });
export type ThreadQuery = z.infer<typeof ThreadQuery>;

export const ThreadInfo = z.object({
  postId: idSchema,
  replyCount: z.number(),
  lastReplyAt: z.number().nullable(),
  participants: z.array(z.string()),
  channelId: z.string().nullable(),
});
export type ThreadInfo = z.infer<typeof ThreadInfo>;
export const ThreadOutput = z.object({ thread: ThreadInfo });
export type ThreadOutput = z.infer<typeof ThreadOutput>;
export const MyThreadsOutput = z.object({ threads: z.array(ThreadInfo) });
export type MyThreadsOutput = z.infer<typeof MyThreadsOutput>;

// ---- reactions ----
export const AddReactionInput = z.object({
  postId: idSchema,
  emojiName: z.string().min(1),
  channelId: idSchema,
});
export type AddReactionInput = z.infer<typeof AddReactionInput>;
export const ReactionsQuery = z.object({ channelId: idSchema });
export type ReactionsQuery = z.infer<typeof ReactionsQuery>;
export const ReactionsOutput = z.object({ reactions: z.record(z.string(), z.array(z.string())) });
export type ReactionsOutput = z.infer<typeof ReactionsOutput>;

// ---- preferences ----
export const PreferenceItem = z.object({
  category: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  value: z.string().max(4096).default(""),
});
export type PreferenceItem = z.infer<typeof PreferenceItem>;
export const PutPreferencesInput = z.array(PreferenceItem).max(1000);
export type PutPreferencesInput = z.infer<typeof PutPreferencesInput>;
export const DeletePreferencesInput = z
  .array(PreferenceItem.pick({ category: true, name: true }))
  .max(1000);
export type DeletePreferencesInput = z.infer<typeof DeletePreferencesInput>;
export const PreferencesOutput = z.object({ preferences: z.array(PreferenceItem) });
export type PreferencesOutput = z.infer<typeof PreferencesOutput>;
export const PreferenceValueOutput = z.object({ value: z.string().nullable() });
export type PreferenceValueOutput = z.infer<typeof PreferenceValueOutput>;

// ---- status ----
export const PutStatusInput = z.object({
  status: UserStatusSchema,
  dndEndTime: z.number().int().positive().nullable().optional(),
});
export type PutStatusInput = z.infer<typeof PutStatusInput>;
export const StatusIdsInput = z.object({ userIds: z.array(idSchema).min(1).max(200) });
export type StatusIdsInput = z.infer<typeof StatusIdsInput>;
export const StatusOutput = z.object({
  userId: idSchema,
  status: UserStatusSchema,
  manual: z.boolean(),
  lastActivityAt: z.number().nullable(),
  dndEndTime: z.number().nullable(),
});
export type StatusOutput = z.infer<typeof StatusOutput>;
export const StatusesOutput = z.object({ statuses: z.record(z.string(), z.string()) });
export type StatusesOutput = z.infer<typeof StatusesOutput>;

// ---- notifications ----
export const NotificationKindSchema = z.enum(["mention", "reply", "dm"]);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;
export const NotificationItem = z.object({
  id: idSchema,
  kind: NotificationKindSchema,
  channelId: idSchema,
  messageId: idSchema,
  seq: z.number(),
  actorId: idSchema,
  preview: z.string(),
  createdAt: z.number(),
  readAt: z.number().nullable(),
});
export type NotificationItem = z.infer<typeof NotificationItem>;
export const NotificationsQuery = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export type NotificationsQuery = z.infer<typeof NotificationsQuery>;
export const NotificationsOutput = z.object({
  notifications: z.array(NotificationItem),
  unread: z.number(),
});
export type NotificationsOutput = z.infer<typeof NotificationsOutput>;
export const MarkNotificationsReadInput = z.object({
  ids: z.array(idSchema).max(200).optional(),
});
export type MarkNotificationsReadInput = z.infer<typeof MarkNotificationsReadInput>;

// ---- uploads ----
export const UploadRequest = z.object({
  channelId: idSchema,
  filename: z.string().min(1).max(512),
  size: z.number().int().positive(),
  contentType: z.string().min(1),
});
export type UploadRequest = z.infer<typeof UploadRequest>;
export const CreateUploadOutput = z.object({ uploadId: idSchema, putUrl: z.string() });
export type CreateUploadOutput = z.infer<typeof CreateUploadOutput>;
export const CompleteUploadOutput = z.object({ messageId: idSchema });
export type CompleteUploadOutput = z.infer<typeof CompleteUploadOutput>;

// ---- files ----
export const FileInfoOutput = z.object({
  id: idSchema,
  name: z.string().nullable(),
  size: z.number().nullable(),
  mimeType: z.string().nullable(),
  extension: z.string().nullable(),
  postId: z.string().nullable(),
  createdAt: z.number().nullable(),
});
export type FileInfoOutput = z.infer<typeof FileInfoOutput>;

// ---- invites ----
export const EmailInput = z.object({ email: emailSchema });
export type EmailInput = z.infer<typeof EmailInput>;
export const InviteEmailInput = z.object({ teamId: idSchema, email: emailSchema });
export type InviteEmailInput = z.infer<typeof InviteEmailInput>;
export const AcceptInviteInput = z.object({ token: z.string().min(1) });
export type AcceptInviteInput = z.infer<typeof AcceptInviteInput>;
export const InviteOutput = z.object({
  id: idSchema,
  email: z.string(),
  createdBy: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  consumedAt: z.number().nullable(),
  revokedAt: z.number().nullable(),
  acceptedBy: z.string().nullable(),
});
export type InviteOutput = z.infer<typeof InviteOutput>;
export const CreateInviteOutput = z.object({
  id: idSchema,
  email: z.string(),
  expiresAt: z.number(),
});
export type CreateInviteOutput = z.infer<typeof CreateInviteOutput>;
export const InvitesListOutput = z.object({ invites: z.array(InviteOutput) });
export type InvitesListOutput = z.infer<typeof InvitesListOutput>;
export const InvitePreviewOutput = z.object({
  teamId: idSchema,
  teamName: z.string(),
  email: z.string(),
  expiresAt: z.number(),
});
export type InvitePreviewOutput = z.infer<typeof InvitePreviewOutput>;
export const AcceptInviteOutput = z.object({ ok: z.boolean(), teamId: idSchema });
export type AcceptInviteOutput = z.infer<typeof AcceptInviteOutput>;

// ---- roles ----
export const RolesInput = z.object({ roles: z.array(RoleNameSchema) });
export type RolesInput = z.infer<typeof RolesInput>;
export const RoleOutput = z.object({
  id: idSchema,
  name: z.string(),
  displayName: z.string(),
  permissions: z.array(z.string()),
  builtIn: z.boolean(),
});
export type RoleOutput = z.infer<typeof RoleOutput>;
export const RolesListOutput = z.object({ roles: z.array(RoleOutput) });
export type RolesListOutput = z.infer<typeof RolesListOutput>;
export const RoleUpdateInput = z.object({ permissions: z.array(z.string()) });
export type RoleUpdateInput = z.infer<typeof RoleUpdateInput>;
export const PermissionsOutput = z.object({ permissions: z.array(z.string()) });
export type PermissionsOutput = z.infer<typeof PermissionsOutput>;
export const SchemesOutput = z.object({ schemes: z.array(z.unknown()) });
export type SchemesOutput = z.infer<typeof SchemesOutput>;

// ---- push ----
export const PushSubscribeInput = z.object({
  deviceId: idSchema,
  kind: PushKindSchema,
  endpoint: z.string().url(),
  p256dh: z.string().optional(),
  auth: z.string().optional(),
});
export type PushSubscribeInput = z.infer<typeof PushSubscribeInput>;

// ---- admin ----
export const RemoveMemberInput = z.object({ userId: idSchema });
export type RemoveMemberInput = z.infer<typeof RemoveMemberInput>;
export const AdminStatsOutput = z.object({
  users: z.number(),
  teams: z.number(),
  channels: z.number(),
  messages: z.number(),
  truncated: z.boolean(),
});
export type AdminStatsOutput = z.infer<typeof AdminStatsOutput>;

// ---- internal ----
export const ThumbnailInput = z.object({
  channelId: idSchema,
  uploadId: idSchema,
  thumbKey: z.string(),
});
export type ThumbnailInput = z.infer<typeof ThumbnailInput>;
export const DeleteSubscriptionInput = z.object({ deviceId: idSchema });
export type DeleteSubscriptionInput = z.infer<typeof DeleteSubscriptionInput>;

// ---- users (global search) ----
export const UserAutocompleteItem = z.object({
  id: idSchema,
  username: z.string().nullable(),
  nickname: z.string().nullable(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type UserAutocompleteItem = z.infer<typeof UserAutocompleteItem>;
export const UserAutocompleteOutput = z.object({ users: z.array(UserAutocompleteItem) });
export type UserAutocompleteOutput = z.infer<typeof UserAutocompleteOutput>;
export const UserAutocompleteQuery = z.object({
  term: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type UserAutocompleteQuery = z.infer<typeof UserAutocompleteQuery>;

/**
 * Batch profile lookup used to render author names/avatars in message lists.
 * `ids` is a comma-separated list capped at 100 entries; unknown ids are
 * omitted rather than reported, so callers must tolerate short results.
 */
export const ListUsersQuery = z.object({
  // 100 ids × ~41 chars (prefix + uuidv7 + separator) with headroom.
  ids: z.string().min(1).max(8192),
});
export type ListUsersQuery = z.infer<typeof ListUsersQuery>;
export const ListUsersOutput = z.object({ users: z.array(UserAutocompleteItem) });
export type ListUsersOutput = z.infer<typeof ListUsersOutput>;

// ---- workspaces (kept, now derived from TeamSummary) ----
export const WorkspaceResponse = z.object({
  teams: z.array(TeamSummary.extend({ channels: z.array(ChannelSummary) })),
  directs: z.array(ChannelSummary),
});
export type WorkspaceResponse = z.infer<typeof WorkspaceResponse>;
