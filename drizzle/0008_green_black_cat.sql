CREATE TABLE `manual_images` (
 `id` text PRIMARY KEY NOT NULL,
 `manual_id` text,
 `media_type` text NOT NULL,
 `data` text NOT NULL,
 `owner_id` text,
 `status` text,
 `created_at` integer,
 `file_size` integer,
 `chunk_count` integer
);
--> statement-breakpoint
CREATE INDEX `manual_images_manual` ON `manual_images` (`manual_id`);
