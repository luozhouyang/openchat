CREATE TABLE `fileinfo` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_id` text,
	`post_id` text,
	`created_at` integer,
	`updated_at` integer,
	`deleted_at` integer,
	`path` text,
	`thumbnail_path` text,
	`preview_path` text,
	`name` text,
	`extension` text,
	`size` integer,
	`mime_type` text,
	`width` integer,
	`height` integer,
	`has_preview_image` integer,
	`mini_preview` text,
	`content` text
);
--> statement-breakpoint
CREATE INDEX `idx_fi_post` ON `fileinfo` (`post_id`);--> statement-breakpoint
CREATE INDEX `idx_fi_creator` ON `fileinfo` (`creator_id`);--> statement-breakpoint
CREATE TABLE `uploadsessions` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text,
	`created_at` integer,
	`user_id` text,
	`channel_id` text,
	`filename` text,
	`path` text,
	`file_size` integer,
	`file_offset` integer DEFAULT 0,
	`req_file_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_upl_user` ON `uploadsessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_upl_channel` ON `uploadsessions` (`channel_id`);--> statement-breakpoint
CREATE INDEX `idx_upl_create` ON `uploadsessions` (`created_at`);