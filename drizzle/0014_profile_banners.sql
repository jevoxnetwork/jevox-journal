ALTER TABLE moderators ADD COLUMN profile_banner text CHECK (profile_banner IN ('forest', 'city', 'blood'));
--> statement-breakpoint
ALTER TABLE former_moderators ADD COLUMN profile_banner text CHECK (profile_banner IN ('forest', 'city', 'blood'));
