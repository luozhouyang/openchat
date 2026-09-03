CREATE TABLE `channel_members` (
	`channel_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`channel_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text,
	`name` text,
	`display_name` text NOT NULL,
	`type` text NOT NULL,
	`dedup_key` text,
	`archived_at` integer,
	`creator_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_channel_team_name` ON `channels` (`team_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_channel_dedup` ON `channels` (`dedup_key`);--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text,
	`type` text NOT NULL,
	`trigger` text,
	`endpoint_url` text,
	`secret` text,
	`creator_id` text
);
--> statement-breakpoint
CREATE TABLE `system_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `team_members` (
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`team_id`, `user_id`)
);
--> statement-breakpoint
ALTER TABLE `teams` ADD `invite_code` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `archived_at` integer;