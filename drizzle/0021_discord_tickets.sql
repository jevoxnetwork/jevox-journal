CREATE TABLE discord_ticket_panel (
  id INTEGER PRIMARY KEY CHECK(id=1),
  message_id TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
--> statement-breakpoint
INSERT INTO discord_ticket_panel (id) VALUES (1);
--> statement-breakpoint
CREATE TABLE discord_tickets (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('support','complaint','other')),
  nickname TEXT NOT NULL,
  answers TEXT NOT NULL,
  channel_id TEXT UNIQUE,
  message_id TEXT,
  assignee_id TEXT,
  closed_by TEXT,
  closed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  revision INTEGER NOT NULL DEFAULT 1,
  synced_revision INTEGER NOT NULL DEFAULT 0,
  leased_until INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX discord_ticket_pending ON discord_tickets(leased_until,created_at)
WHERE synced_revision<revision;
