CREATE TABLE `server_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`player` text NOT NULL,
	`player_uuid` text NOT NULL,
	`moderator` text NOT NULL,
	`moderator_uuid` text NOT NULL,
	`reason` text NOT NULL,
	`started` integer NOT NULL,
	`ended` integer NOT NULL,
	`result` text NOT NULL,
	`type` text NOT NULL,
	`active` integer NOT NULL,
	`removed_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `server_checks_moderator` ON `server_checks` (`moderator`);--> statement-breakpoint
CREATE INDEX `server_checks_player` ON `server_checks` (`player`);--> statement-breakpoint
CREATE INDEX `server_checks_started` ON `server_checks` (`started`);--> statement-breakpoint
CREATE TABLE `server_punishments` (
	`id` text PRIMARY KEY NOT NULL,
	`player` text NOT NULL,
	`player_uuid` text NOT NULL,
	`moderator` text NOT NULL,
	`moderator_uuid` text NOT NULL,
	`reason` text NOT NULL,
	`started` integer NOT NULL,
	`ended` integer NOT NULL,
	`result` text NOT NULL,
	`type` text NOT NULL,
	`active` integer NOT NULL,
	`removed_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `server_punishments_moderator` ON `server_punishments` (`moderator`);--> statement-breakpoint
CREATE INDEX `server_punishments_player` ON `server_punishments` (`player`);--> statement-breakpoint
CREATE INDEX `server_punishments_started` ON `server_punishments` (`started`);--> statement-breakpoint
CREATE TABLE `server_sync` (
	`kind` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL
);
