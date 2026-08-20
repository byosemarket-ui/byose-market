-- Delivery diagnostics for production retry/monitoring.
-- Keeps history in SQLite so VPS restarts do not lose failed/pending email state.

ALTER TABLE notification_email_deliveries ADD COLUMN error_category TEXT;
ALTER TABLE notification_email_deliveries ADD COLUMN last_attempt_at TEXT;

CREATE INDEX IF NOT EXISTS idx_notification_email_failed
  ON notification_email_deliveries (status, updated_at DESC);
