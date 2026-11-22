CREATE TABLE `former_moderators` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`nickname` text NOT NULL,
	`position` text NOT NULL,
	`real_name` text NOT NULL,
	`birth_date` text NOT NULL,
	`appointment_date` text,
	`vk_id` text,
	`telegram_id` text,
	`joined_at` integer NOT NULL,
	`removed_at` integer NOT NULL,
	`removed_by` text NOT NULL,
	`removed_by_name` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `moderators` ADD `appointment_date` text;