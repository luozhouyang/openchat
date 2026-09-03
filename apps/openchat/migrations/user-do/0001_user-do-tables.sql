CREATE TABLE `channels_cache` (
	`channel_id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `presence_subscribers` (
	`user_id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `presence_subscriptions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`device_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text,
	`auth` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sidebar_cache` (
	`channel_id` text PRIMARY KEY NOT NULL,
	`max_seq` integer DEFAULT 0 NOT NULL,
	`last_message_preview` text,
	`last_message_user_id` text,
	`last_message_at` integer,
	`last_read_seq` integer DEFAULT 0 NOT NULL,
	`mention_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
