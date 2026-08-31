CREATE TABLE `thread_memberships` (
	`post_id` text NOT NULL,
	`user_id` text NOT NULL,
	`following` integer DEFAULT true NOT NULL,
	`last_viewed` integer,
	`last_updated` integer,
	`unread_mentions` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`post_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `threads` (
	`post_id` text PRIMARY KEY NOT NULL,
	`reply_count` integer DEFAULT 0 NOT NULL,
	`last_reply_at` integer,
	`participants` text,
	`channel_id` text
);
--> statement-breakpoint
ALTER TABLE `messages` ADD `file_ids` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `props` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `hashtags` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `is_pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `has_reactions` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `updated_at` integer;--> statement-breakpoint
CREATE INDEX `idx_msg_created` ON `messages` (`created_at`);--> statement-breakpoint
ALTER TABLE `reactions` ADD `update_at` integer;--> statement-breakpoint
ALTER TABLE `reactions` ADD `delete_at` integer;