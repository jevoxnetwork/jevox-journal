CREATE TABLE web_checks (
  id TEXT PRIMARY KEY, staff_id TEXT NOT NULL, moderator TEXT NOT NULL,
  player TEXT NOT NULL COLLATE NOCASE, reason TEXT NOT NULL, seconds INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued', detail TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL,
  missing_since INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX web_check_active_staff ON web_checks(staff_id) WHERE state IN ('queued','active');
--> statement-breakpoint
CREATE UNIQUE INDEX web_check_active_player ON web_checks(player) WHERE state IN ('queued','active');
--> statement-breakpoint
CREATE TABLE web_check_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, check_id TEXT NOT NULL, kind TEXT NOT NULL,
  body TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued', detail TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL, claimed INTEGER
);
--> statement-breakpoint
CREATE INDEX web_check_job_queue ON web_check_jobs(state,id);
--> statement-breakpoint
CREATE UNIQUE INDEX web_check_final_job ON web_check_jobs(check_id) WHERE kind IN ('release','ban') AND state IN ('queued','claimed');
--> statement-breakpoint
CREATE TABLE web_check_messages (
  id TEXT PRIMARY KEY, check_id TEXT NOT NULL, side TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX web_check_messages_session ON web_check_messages(check_id,created);
--> statement-breakpoint
CREATE TABLE web_check_bridge (id INTEGER PRIMARY KEY CHECK (id=1), seen INTEGER NOT NULL);
