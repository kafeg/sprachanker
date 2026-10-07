DROP INDEX `card_state_due`;--> statement-breakpoint
CREATE INDEX `events_type_ts` ON `events` (`type`,`ts`);