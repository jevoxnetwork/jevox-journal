CREATE TABLE `staff_sanctions` (
	`id` text PRIMARY KEY NOT NULL,
	`moderator_id` text NOT NULL,
	`moderator_name` text NOT NULL,
	`type` text NOT NULL,
	`reason` text NOT NULL,
	`issued_by` text NOT NULL,
	`issued_by_name` text NOT NULL,
	`issued_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_by` text,
	`revoked_by_name` text
);
--> statement-breakpoint
CREATE INDEX `staff_sanctions_moderator` ON `staff_sanctions` (`moderator_id`);--> statement-breakpoint
ALTER TABLE `former_moderators` ADD `staff_since` text;--> statement-breakpoint
ALTER TABLE `moderators` ADD `staff_since` text;