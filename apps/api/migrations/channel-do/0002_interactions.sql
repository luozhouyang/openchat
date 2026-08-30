CREATE TABLE `reactions` (
	`message_seq` integer NOT NULL,
	`emoji` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`message_seq`, `emoji`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `thread_subscriptions` (
	`parent_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`parent_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_msg_parent` ON `messages` (`parent_id`,`seq`);