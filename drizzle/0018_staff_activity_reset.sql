ALTER TABLE staff_journal_controls ADD COLUMN activity_reset_at INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE auth_audit ADD COLUMN hidden_from_staff_logs INTEGER NOT NULL DEFAULT 0;
