CREATE TABLE `manual_image_chunks` (
 `id` text PRIMARY KEY NOT NULL,
 `image_id` text NOT NULL,
 `chunk_index` integer NOT NULL,
 `data` text NOT NULL,
 `byte_length` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `manual_image_chunks_order` ON `manual_image_chunks` (`image_id`,`chunk_index`);
