import { z } from "zod";

export const CHANNEL_TYPES = ["public", "private", "dm", "gm"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];
export const ChannelTypeSchema = z.enum(CHANNEL_TYPES);

export const TEAM_TYPES = ["open", "invite"] as const;
export type TeamType = (typeof TEAM_TYPES)[number];
export const TeamTypeSchema = z.enum(TEAM_TYPES);

export const MESSAGE_TYPES = ["text", "file", "system"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];
export const MessageTypeSchema = z.enum(MESSAGE_TYPES);

export const ROLE_NAMES = [
  "system_user",
  "system_admin",
  "team_user",
  "team_admin",
  "channel_user",
  "channel_admin",
] as const;
export type RoleName = (typeof ROLE_NAMES)[number];
export const RoleNameSchema = z.enum(ROLE_NAMES);

export const USER_STATUSES = ["online", "away", "dnd", "offline"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
export const UserStatusSchema = z.enum(USER_STATUSES);

export const NOTIF_PREFS = ["all", "mention", "none"] as const;
export type NotifPref = (typeof NOTIF_PREFS)[number];
export const NotifPrefSchema = z.enum(NOTIF_PREFS);

export const PUSH_KINDS = ["webpush", "fcm", "apns"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];
export const PushKindSchema = z.enum(PUSH_KINDS);

export const SORT_ORDERS = ["asc", "desc"] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];
export const SortOrderSchema = z.enum(SORT_ORDERS);
