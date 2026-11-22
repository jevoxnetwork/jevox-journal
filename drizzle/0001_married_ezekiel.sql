CREATE TABLE `moderators` (
	`id` text PRIMARY KEY NOT NULL,
	`nickname` text NOT NULL,
	`position` text NOT NULL,
	`real_name` text NOT NULL,
	`birth_date` text NOT NULL,
	`vk_id` text,
	`telegram_id` text,
	`journal_admin` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `moderators_nickname` ON `moderators` (`nickname` COLLATE NOCASE);--> statement-breakpoint
CREATE UNIQUE INDEX `moderators_vk_id` ON `moderators` (`vk_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `moderators_telegram_id` ON `moderators` (`telegram_id`);