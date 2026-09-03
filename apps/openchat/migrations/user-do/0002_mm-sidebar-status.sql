CREATE TABLE `sidebarcategories` (
	`id` text(128) PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`team_id` text,
	`sort_order` integer,
	`sorting` text,
	`type` text,
	`display_name` text,
	`muted` integer DEFAULT false NOT NULL,
	`collapsed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sidebarchannels` (
	`channel_id` text NOT NULL,
	`user_id` text NOT NULL,
	`category_id` text NOT NULL,
	`sort_order` integer,
	PRIMARY KEY(`channel_id`, `user_id`, `category_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_sbc_user` ON `sidebarchannels` (`user_id`);--> statement-breakpoint
CREATE TABLE `status` (
	`user_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'offline' NOT NULL,
	`manual` integer DEFAULT false NOT NULL,
	`last_activity_at` integer,
	`dnd_end_time` integer,
	`prev_status` text
);
