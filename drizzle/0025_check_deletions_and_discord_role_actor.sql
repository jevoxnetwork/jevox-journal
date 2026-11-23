CREATE TABLE deleted_server_checks (
  id TEXT PRIMARY KEY NOT NULL,
  deleted_at INTEGER NOT NULL
);
--> statement-breakpoint
ALTER TABLE discord_role_jobs ADD COLUMN changed_by TEXT;
--> statement-breakpoint
CREATE TRIGGER discord_role_job_reset_actor AFTER UPDATE OF revision ON discord_role_jobs
WHEN OLD.revision IS NOT NEW.revision AND NEW.changed_by IS NOT NULL BEGIN
  UPDATE discord_role_jobs SET changed_by=NULL WHERE discord_id=NEW.discord_id;
END;
