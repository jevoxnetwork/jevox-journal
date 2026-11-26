-- Older deployments share this database. Revoke their sessions and prevent further issuance.
DELETE FROM auth_sessions;
--> statement-breakpoint
DELETE FROM auth_flows;
--> statement-breakpoint
CREATE TRIGGER prevent_legacy_session_insert BEFORE INSERT ON auth_sessions
BEGIN
  SELECT RAISE(ABORT, 'Legacy session authentication is disabled');
END;
--> statement-breakpoint
CREATE TRIGGER prevent_legacy_flow_insert BEFORE INSERT ON auth_flows
BEGIN
  SELECT RAISE(ABORT, 'Legacy session authentication is disabled');
END;
