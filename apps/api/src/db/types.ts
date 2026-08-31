import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as d1 from "./schema-d1.ts";
import * as userDo from "./schema-user-do.ts";
import * as channelDo from "./schema-channel-do.ts";

export type Db = DrizzleD1Database<typeof d1>;

export type Team = typeof d1.teams.$inferSelect;
export type TeamInsert = typeof d1.teams.$inferInsert;
export type TeamMember = typeof d1.teamMembers.$inferSelect;
export type TeamMemberInsert = typeof d1.teamMembers.$inferInsert;
export type Channel = typeof d1.channels.$inferSelect;
export type ChannelInsert = typeof d1.channels.$inferInsert;
export type ChannelMember = typeof d1.channelMembers.$inferSelect;
export type ChannelMemberInsert = typeof d1.channelMembers.$inferInsert;
export type UploadSession = typeof d1.uploadsessions.$inferSelect;
export type UploadSessionInsert = typeof d1.uploadsessions.$inferInsert;
export type FileInfo = typeof d1.fileinfo.$inferSelect;
export type FileInfoInsert = typeof d1.fileinfo.$inferInsert;
export type Invite = typeof d1.invites.$inferSelect;
export type InviteInsert = typeof d1.invites.$inferInsert;
export type Preference = typeof d1.preferences.$inferSelect;
export type PreferenceInsert = typeof d1.preferences.$inferInsert;
export type Role = typeof d1.roles.$inferSelect;
export type RoleInsert = typeof d1.roles.$inferInsert;
export type Scheme = typeof d1.schemes.$inferSelect;
export type UserRow = typeof d1.users.$inferSelect;

export type ChannelDoMessage = typeof channelDo.messages.$inferSelect;
export type ChannelDoMessageInsert = typeof channelDo.messages.$inferInsert;
export type ChannelDoMemberState = typeof channelDo.memberState.$inferSelect;
export type ChannelDoThread = typeof channelDo.threads.$inferSelect;
export type ChannelDoReaction = typeof channelDo.reactions.$inferSelect;

export type UserDoStatus = typeof userDo.status.$inferSelect;
export type UserDoPushSubscription = typeof userDo.pushSubscriptions.$inferSelect;
export type UserDoSidebarCache = typeof userDo.sidebarCache.$inferSelect;
export type UserDoSidebarCategory = typeof userDo.sidebarcategories.$inferSelect;
export type UserDoSidebarChannel = typeof userDo.sidebarchannels.$inferSelect;
