CREATE TABLE `couple_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`role` integer NOT NULL,
	`token_hash` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`space_id`) REFERENCES `couple_spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `couple_devices_token_unique` ON `couple_devices` (`token_hash`);--> statement-breakpoint
CREATE INDEX `couple_devices_member_idx` ON `couple_devices` (`space_id`,`role`);--> statement-breakpoint
CREATE TABLE `couple_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`role` integer NOT NULL,
	`invite_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`revoked_at` integer,
	`claimed_by` text,
	FOREIGN KEY (`space_id`) REFERENCES `couple_spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `couple_invites_hash_unique` ON `couple_invites` (`invite_hash`);--> statement-breakpoint
CREATE INDEX `couple_invites_space_idx` ON `couple_invites` (`space_id`);--> statement-breakpoint
CREATE TABLE `couple_members` (
	`space_id` text NOT NULL,
	`role` integer NOT NULL,
	`recovery_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`space_id`, `role`),
	FOREIGN KEY (`space_id`) REFERENCES `couple_spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `couple_operations` (
	`space_id` text NOT NULL,
	`device_id` text NOT NULL,
	`mutation_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`response_json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`space_id`, `device_id`, `mutation_id`),
	FOREIGN KEY (`space_id`) REFERENCES `couple_spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `couple_operations_age_idx` ON `couple_operations` (`space_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `couple_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`hits` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `couple_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`revision` integer NOT NULL,
	`state_json` text NOT NULL,
	`reason` text NOT NULL,
	`task_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `couple_spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `couple_snapshots_space_idx` ON `couple_snapshots` (`space_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `couple_spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`state_json` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`zone` text NOT NULL,
	`write_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
