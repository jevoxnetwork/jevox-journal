CREATE TRIGGER discord_staff_renamed AFTER UPDATE OF nickname ON moderators
WHEN NEW.discord_id IS NOT NULL AND OLD.nickname IS NOT NEW.nickname
  AND OLD.discord_id IS NEW.discord_id AND OLD.position IS NEW.position BEGIN
  INSERT INTO discord_role_jobs (discord_id,nickname,reason)
  VALUES (NEW.discord_id,NEW.nickname,'Игровой ник изменён в журнале')
  ON CONFLICT(discord_id) DO UPDATE SET
    nickname=excluded.nickname,reason=excluded.reason,revision=excluded.revision,queued_at=excluded.queued_at;
END;
