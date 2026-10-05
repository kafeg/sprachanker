CREATE TABLE `llm_routes` (
	`task` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`model` text,
	`params_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `secrets` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`value_encrypted` text NOT NULL
);
