ALTER TABLE `channel_members` ADD `roles` text DEFAULT 'channel_user' NOT NULL;--> statement-breakpoint
ALTER TABLE `channel_members` ADD `last_viewed_at` integer;--> statement-breakpoint
ALTER TABLE `channel_members` ADD `msg_count` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `channel_members` ADD `msg_count_root` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `channel_members` ADD `mention_count` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `channel_members` ADD `mention_count_root` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `channel_members` ADD `notify_props` text;--> statement-breakpoint
ALTER TABLE `channel_members` ADD `last_update_at` integer;--> statement-breakpoint
ALTER TABLE `channel_members` ADD `scheme_user` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `channel_members` ADD `scheme_admin` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `channel_members` ADD `scheme_guest` integer DEFAULT false;--> statement-breakpoint
CREATE INDEX `idx_cm_user` ON `channel_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_cm_channel` ON `channel_members` (`channel_id`);--> statement-breakpoint
ALTER TABLE `channels` ADD `header` text;--> statement-breakpoint
ALTER TABLE `channels` ADD `purpose` text;--> statement-breakpoint
ALTER TABLE `channels` ADD `last_post_at` integer;--> statement-breakpoint
ALTER TABLE `channels` ADD `total_msg_count` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `channels` ADD `total_msg_count_root` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `channels` ADD `last_root_post_at` integer;--> statement-breakpoint
ALTER TABLE `channels` ADD `extra_update_at` integer;--> statement-breakpoint
ALTER TABLE `channels` ADD `scheme_id` text;--> statement-breakpoint
ALTER TABLE `channels` ADD `shared` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `channels` ADD `group_constrained` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `channels` ADD `updated_at` integer;--> statement-breakpoint
CREATE INDEX `idx_channel_team` ON `channels` (`team_id`);--> statement-breakpoint
ALTER TABLE `team_members` ADD `roles` text DEFAULT 'team_user' NOT NULL;--> statement-breakpoint
ALTER TABLE `team_members` ADD `delete_at` integer;--> statement-breakpoint
ALTER TABLE `team_members` ADD `scheme_user` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `team_members` ADD `scheme_admin` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `team_members` ADD `scheme_guest` integer DEFAULT false;--> statement-breakpoint
CREATE INDEX `idx_tm_user` ON `team_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_tm_team` ON `team_members` (`team_id`);--> statement-breakpoint
ALTER TABLE `teams` ADD `description` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `email` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `company_name` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `allowed_domains` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `scheme_id` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `group_constrained` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `teams` ADD `updated_at` integer;