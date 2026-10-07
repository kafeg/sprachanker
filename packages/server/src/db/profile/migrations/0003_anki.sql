PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_card_state` (
	`card_id` text NOT NULL,
	`face` text NOT NULL,
	`fsrs_json` text,
	`due_at` integer,
	`suspended` integer DEFAULT 0 NOT NULL,
	`buried_until` integer,
	`flag` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`card_id`, `face`),
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_card_state`("card_id", "face", "fsrs_json", "due_at", "suspended", "buried_until", "flag") SELECT "card_id", "face", "fsrs_json", "due_at", 0, NULL, 0 FROM `card_state`;--> statement-breakpoint
DROP TABLE `card_state`;--> statement-breakpoint
ALTER TABLE `__new_card_state` RENAME TO `card_state`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `card_state_due` ON `card_state` (`due_at`);--> statement-breakpoint
ALTER TABLE `cards` ADD `marked` integer DEFAULT 0 NOT NULL;