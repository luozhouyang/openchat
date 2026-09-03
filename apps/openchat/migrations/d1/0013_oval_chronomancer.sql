CREATE TABLE `user_status` (
	`user_id` text PRIMARY KEY NOT NULL,
	`online` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'offline' NOT NULL,
	`manual` integer DEFAULT false NOT NULL,
	`last_activity_at` integer,
	`dnd_end_time` integer,
	`prev_status` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_user_status_online` ON `user_status` (`online`);