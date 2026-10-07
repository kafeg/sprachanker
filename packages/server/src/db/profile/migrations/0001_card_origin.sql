PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cards` (
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
	`marked` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`origin_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`origin_event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_cards`("id", "kind", "lexeme_key", "source_key", "origin_run_id", "origin_event_id", "fields_json", "faces", "display_cache_json", "suspended", "marked", "created_at") SELECT "id", "kind", "lexeme_key", "source_key", "origin_run_id", "origin_event_id", "fields_json", "faces", "display_cache_json", "suspended", "marked", "created_at" FROM `cards`;--> statement-breakpoint
DROP TABLE `cards`;--> statement-breakpoint
ALTER TABLE `__new_cards` RENAME TO `cards`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `cards_lexeme` ON `cards` (`lexeme_key`);