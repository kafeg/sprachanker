CREATE TABLE `card_state` (
	`card_id` text NOT NULL,
	`face` text NOT NULL,
	`fsrs_json` text,
	`suspended` integer DEFAULT 0 NOT NULL,
	`buried_until` integer,
	`flag` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`card_id`, `face`),
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`lexeme_key` text,
	`translation_lang` text NOT NULL,
	`source_key` text,
	`origin_run_id` text,
	`faces` text NOT NULL,
	`display_cache_json` text,
	`suspended` integer DEFAULT 0 NOT NULL,
	`marked` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`origin_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_lexeme` ON `cards` (`lexeme_key`,`translation_lang`);--> statement-breakpoint
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
CREATE INDEX `events_type_ts` ON `events` (`type`,`ts`);--> statement-breakpoint
CREATE TABLE `llm_routes` (
	`task` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`model` text
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`context_key` text,
	`course_key` text,
	`edition` text,
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
CREATE TABLE `secrets` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`value_encrypted` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL
);
