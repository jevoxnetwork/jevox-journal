CREATE TABLE journal_browser_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  device_hash TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX journal_browser_sessions_user ON journal_browser_sessions (user_id);
--> statement-breakpoint
CREATE TABLE journal_browser_flows (
  state_hash TEXT PRIMARY KEY NOT NULL,
  device_hash TEXT NOT NULL,
  browser_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
