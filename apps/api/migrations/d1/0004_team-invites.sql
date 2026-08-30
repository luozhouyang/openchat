CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`revoked_at` integer,
	`accepted_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash_unique` ON `invites` (`token_hash`);