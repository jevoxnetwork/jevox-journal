CREATE TABLE `ban_form_numbers` (
	`number` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`form_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ban_form_numbers_form` ON `ban_form_numbers` (`form_id`);
--> statement-breakpoint
INSERT INTO `ban_form_numbers` (`form_id`) SELECT `id` FROM `ban_forms` ORDER BY `created_at`, `id`;
