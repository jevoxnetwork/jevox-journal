DROP TRIGGER IF EXISTS discord_roster_joined;
--> statement-breakpoint
DROP TRIGGER IF EXISTS discord_roster_position;
--> statement-breakpoint
DROP TRIGGER IF EXISTS discord_roster_removed;
--> statement-breakpoint
CREATE TABLE discord_roster_board (
  id INTEGER PRIMARY KEY CHECK(id=1),
  message_id TEXT,
  fingerprint TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_key TEXT,
  verified_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
--> statement-breakpoint
INSERT INTO discord_roster_board (id) VALUES (1);
--> statement-breakpoint
CREATE TABLE discord_roster_emojis (
  name TEXT PRIMARY KEY,
  emoji_id TEXT NOT NULL
);
