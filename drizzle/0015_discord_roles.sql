ALTER TABLE moderators ADD COLUMN discord_id text;
--> statement-breakpoint
ALTER TABLE former_moderators ADD COLUMN discord_id text;
--> statement-breakpoint
CREATE UNIQUE INDEX moderators_discord_id ON moderators(discord_id);
--> statement-breakpoint
CREATE TABLE discord_role_jobs (
  discord_id text PRIMARY KEY,
  nickname text NOT NULL,
  reason text NOT NULL,
  previous_position text,
  revision text NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  queued_at integer NOT NULL DEFAULT (unixepoch()),
  leased_until integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TRIGGER discord_staff_added AFTER INSERT ON moderators WHEN NEW.discord_id IS NOT NULL BEGIN
  INSERT INTO discord_role_jobs (discord_id,nickname,reason)
  VALUES (NEW.discord_id,NEW.nickname,'Сотрудник добавлен или восстановлен в журнале')
  ON CONFLICT(discord_id) DO UPDATE SET nickname=excluded.nickname,reason=excluded.reason,previous_position=coalesce(discord_role_jobs.previous_position,excluded.previous_position),revision=excluded.revision,queued_at=excluded.queued_at;
END;
--> statement-breakpoint
CREATE TRIGGER discord_staff_changed AFTER UPDATE OF position,discord_id ON moderators
WHEN OLD.position IS NOT NEW.position OR OLD.discord_id IS NOT NEW.discord_id BEGIN
  INSERT INTO discord_role_jobs (discord_id,nickname,reason,previous_position)
  SELECT OLD.discord_id,OLD.nickname,'Discord ID изменён в журнале',OLD.position
  WHERE OLD.discord_id IS NOT NULL AND OLD.discord_id IS NOT NEW.discord_id
  ON CONFLICT(discord_id) DO UPDATE SET nickname=excluded.nickname,reason=excluded.reason,previous_position=coalesce(discord_role_jobs.previous_position,excluded.previous_position),revision=excluded.revision,queued_at=excluded.queued_at;
  INSERT INTO discord_role_jobs (discord_id,nickname,reason,previous_position)
  SELECT NEW.discord_id,NEW.nickname,CASE WHEN OLD.position IS NOT NEW.position THEN 'Должность изменена в журнале' ELSE 'Discord ID привязан в журнале' END,CASE WHEN OLD.discord_id=NEW.discord_id THEN OLD.position END
  WHERE NEW.discord_id IS NOT NULL
  ON CONFLICT(discord_id) DO UPDATE SET nickname=excluded.nickname,reason=excluded.reason,previous_position=coalesce(discord_role_jobs.previous_position,excluded.previous_position),revision=excluded.revision,queued_at=excluded.queued_at;
END;
--> statement-breakpoint
CREATE TRIGGER discord_staff_removed AFTER DELETE ON moderators WHEN OLD.discord_id IS NOT NULL BEGIN
  INSERT INTO discord_role_jobs (discord_id,nickname,reason,previous_position)
  VALUES (OLD.discord_id,OLD.nickname,'Сотрудник снят в журнале',OLD.position)
  ON CONFLICT(discord_id) DO UPDATE SET nickname=excluded.nickname,reason=excluded.reason,previous_position=coalesce(discord_role_jobs.previous_position,excluded.previous_position),revision=excluded.revision,queued_at=excluded.queued_at;
END;
