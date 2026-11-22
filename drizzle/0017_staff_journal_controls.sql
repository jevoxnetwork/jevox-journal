ALTER TABLE journal_notifications ADD COLUMN cleared_at INTEGER;
--> statement-breakpoint
ALTER TABLE journal_notifications ADD COLUMN position_history_hidden_at INTEGER;
--> statement-breakpoint
CREATE TABLE staff_journal_controls (
  moderator_id TEXT PRIMARY KEY NOT NULL,
  checks_delta INTEGER,
  punishments_delta INTEGER,
  hide_logs_through INTEGER NOT NULL DEFAULT 0
);
