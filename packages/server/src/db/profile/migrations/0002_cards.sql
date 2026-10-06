CREATE TABLE `card_state` (
	`card_id` text NOT NULL,
	`face` text NOT NULL,
	`fsrs_json` text NOT NULL,
	`due_at` integer NOT NULL,
	PRIMARY KEY(`card_id`, `face`),
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `card_state_due` ON `card_state` (`due_at`);--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`lexeme_key` text,
	`source_key` text,
	`origin_run_id` text,
	`origin_event_id` text,
	`fields_json` text,
	`faces` text NOT NULL,
	`display_cache_json` text,
	`suspended` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_lexeme` ON `cards` (`lexeme_key`);