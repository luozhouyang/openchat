import { z } from "zod";

const slug = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

export const CreateTeamInput = z.object({
  name: slug,
  displayName: z.string().min(1).max(128),
  type: z.enum(["open", "invite"]).default("open"),
});
export type CreateTeamInput = z.infer<typeof CreateTeamInput>;

export const CreateChannelInput = z.object({
  name: slug.optional(),
  displayName: z.string().min(1).max(128),
  type: z.enum(["public", "private"]),
});
export type CreateChannelInput = z.infer<typeof CreateChannelInput>;

export const JoinTeamInput = z.object({
  inviteCode: z.string().max(128).optional(),
});
export type JoinTeamInput = z.infer<typeof JoinTeamInput>;

export const OpenDmInput = z.object({ withUserId: z.string().min(1) });
export type OpenDmInput = z.infer<typeof OpenDmInput>;

export const OpenGmInput = z.object({
  userIds: z.array(z.string().min(1)).min(3).max(8),
});
export type OpenGmInput = z.infer<typeof OpenGmInput>;

export const TeamSummary = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  type: z.enum(["open", "invite"]),
  role: z.enum(["admin", "member"]),
  archivedAt: z.number().nullable(),
});
export type TeamSummary = z.infer<typeof TeamSummary>;

export const ChannelSummary = z.object({
  id: z.string(),
  teamId: z.string().nullable(),
  name: z.string().nullable(),
  displayName: z.string(),
  type: z.enum(["public", "private", "dm", "gm"]),
  member: z.boolean(),
  archivedAt: z.number().nullable(),
});
export type ChannelSummary = z.infer<typeof ChannelSummary>;

export const WorkspaceResponse = z.object({
  teams: z.array(TeamSummary.extend({ channels: z.array(ChannelSummary) })),
});
export type WorkspaceResponse = z.infer<typeof WorkspaceResponse>;
