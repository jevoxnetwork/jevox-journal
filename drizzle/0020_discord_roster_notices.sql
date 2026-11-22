CREATE TABLE discord_roster_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  moderator_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('joined','position','removed')),
  discord_id TEXT,
  nickname TEXT NOT NULL,
  position TEXT NOT NULL,
  previous_position TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  leased_until INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX discord_roster_notice_order ON discord_roster_notices(moderator_id,id);
--> statement-breakpoint
CREATE TRIGGER discord_roster_joined AFTER INSERT ON moderators BEGIN
  INSERT INTO discord_roster_notices (moderator_id,kind,discord_id,nickname,position)
  VALUES (NEW.id,'joined',NEW.discord_id,NEW.nickname,NEW.position);
END;
--> statement-breakpoint
CREATE TRIGGER discord_roster_position AFTER UPDATE OF position ON moderators
WHEN OLD.position IS NOT NEW.position BEGIN
  INSERT INTO discord_roster_notices (moderator_id,kind,discord_id,nickname,position,previous_position)
  VALUES (NEW.id,'position',NEW.discord_id,NEW.nickname,NEW.position,OLD.position);
END;
--> statement-breakpoint
CREATE TRIGGER discord_roster_removed AFTER INSERT ON former_moderators BEGIN
  INSERT INTO discord_roster_notices (moderator_id,kind,discord_id,nickname,position,reason)
  VALUES (NEW.source_id,'removed',NEW.discord_id,NEW.nickname,NEW.position,NEW.removal_reason);
END;
