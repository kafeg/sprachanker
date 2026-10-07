DROP INDEX `cards_lexeme`;--> statement-breakpoint
ALTER TABLE `cards` ADD `translation_lang` text;--> statement-breakpoint
CREATE UNIQUE INDEX `cards_lexeme` ON `cards` (`lexeme_key`,`translation_lang`);