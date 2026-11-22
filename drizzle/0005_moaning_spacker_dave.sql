ALTER TABLE `former_moderators` ADD `removal_reason` text;--> statement-breakpoint
ALTER TABLE `former_moderators` ADD `journal_admin` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `former_moderators` ADD `restored_at` integer;--> statement-breakpoint
ALTER TABLE `former_moderators` ADD `restored_by` text;