CREATE TABLE `dedup_tokens` (
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`message_seq` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `token`)
);
--> statement-breakpoint
CREATE TABLE `member_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`last_read_seq` integer DEFAULT 0 NOT NULL,
	`mention_count` integer DEFAULT 0 NOT NULL,
	`notif_pref` text DEFAULT 'all' NOT NULL,
	`joined_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`parent_id` text,
	`type` text DEFAULT 'text' NOT NULL,
	`content` text NOT NULL,
	`attachments` text,
	`mentions` text,
	`edited_at` integer,
	`deleted_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_id_unique` ON `messages` (`id`);--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
