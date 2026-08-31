CREATE TABLE `preferences` (
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`user_id`, `category`, `name`)
);
--> statement-breakpoint
CREATE INDEX `idx_pref_category` ON `preferences` (`category`);--> statement-breakpoint
CREATE INDEX `idx_pref_user` ON `preferences` (`user_id`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`permissions` text NOT NULL,
	`built_in` integer DEFAULT false,
	`created_at` integer,
	`updated_at` integer,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_name_unique` ON `roles` (`name`);--> statement-breakpoint
CREATE TABLE `schemes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`scope` text NOT NULL,
	`default_team_admin_role` text,
	`default_team_user_role` text,
	`default_channel_admin_role` text,
	`default_channel_user_role` text,
	`created_at` integer,
	`updated_at` integer,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schemes_name_unique` ON `schemes` (`name`);