CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`ts` integer NOT NULL,
	`device_id` text,
	`type` text NOT NULL,
	`item_key` text,
	`card_id` text,
	`payload_json` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_run` ON `events` (`run_id`,`ts`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`context_key` text,
	`course_key` text,
	`edition` text,
	`content_version` text,
	`app_version` text NOT NULL,
	`plan_json` text,
	`status` text NOT NULL,
	`end_reason` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`result_json` text
);
--> statement-breakpoint
CREATE INDEX `runs_context` ON `runs` (`context_key`,`status`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL
);
