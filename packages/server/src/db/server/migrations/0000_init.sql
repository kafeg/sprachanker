CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`user_agent` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_token` ON `devices` (`token_hash`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`colour` text NOT NULL,
	`onboarded` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `server_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL
);
