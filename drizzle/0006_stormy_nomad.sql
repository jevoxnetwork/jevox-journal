CREATE TABLE `ban_forms` (
	`id` text PRIMARY KEY NOT NULL,
	`target` text NOT NULL,
	`reason` text NOT NULL,
	`duration` text NOT NULL,
	`evidence` text NOT NULL,
	`creator_key` text NOT NULL,
	`creator_name` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`reviewer_key` text,
	`reviewer_name` text,
	`reviewed_at` integer,
	`decision_reason` text,
	`executed_at` integer
);
--> statement-breakpoint
CREATE TABLE `journal_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`moderator_id` text NOT NULL,
	`message` text NOT NULL,
	`created_at` integer NOT NULL,
	`read_at` integer
);
