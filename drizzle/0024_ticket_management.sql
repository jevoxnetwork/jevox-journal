ALTER TABLE discord_tickets ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
--> statement-breakpoint
ALTER TABLE discord_tickets ADD COLUMN synced_priority TEXT;
--> statement-breakpoint
ALTER TABLE discord_tickets ADD COLUMN claim_announced INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE discord_tickets ADD COLUMN close_announced INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE discord_tickets ADD COLUMN delete_after INTEGER;
--> statement-breakpoint
ALTER TABLE discord_tickets ADD COLUMN deleted_at INTEGER;
--> statement-breakpoint
UPDATE discord_tickets SET priority=CASE WHEN kind='support' THEN 'urgent' ELSE 'normal' END,
  synced_priority=CASE WHEN kind='support' THEN 'urgent' ELSE 'normal' END,
  claim_announced=(assignee_id IS NOT NULL),close_announced=(closed_at IS NOT NULL),
  revision=revision+CASE WHEN closed_at IS NULL THEN 1 ELSE 0 END;
--> statement-breakpoint
CREATE TABLE discord_ticket_guests (
  ticket_id TEXT NOT NULL REFERENCES discord_tickets(id),
  user_id TEXT NOT NULL,
  PRIMARY KEY(ticket_id,user_id)
);
--> statement-breakpoint
CREATE TRIGGER discord_ticket_guest_added AFTER INSERT ON discord_ticket_guests BEGIN
  UPDATE discord_tickets SET revision=revision+1 WHERE id=NEW.ticket_id;
END;
--> statement-breakpoint
CREATE INDEX discord_tickets_delete_due ON discord_tickets(delete_after,leased_until)
WHERE deleted_at IS NULL AND delete_after IS NOT NULL;
--> statement-breakpoint
CREATE TABLE discord_ticket_setup (
  id INTEGER PRIMARY KEY CHECK(id=1),
  command_version INTEGER NOT NULL DEFAULT 0,
  commands_lease INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  emoji_json TEXT
);
--> statement-breakpoint
INSERT INTO discord_ticket_setup(id) VALUES (1);
