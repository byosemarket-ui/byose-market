-- Historical table from STEP 5 Admin SMS.
-- Admin notifications are now email-only. This table is retained unused so
-- existing production rows are not destroyed. The Admin Notification Engine
-- no longer reads or writes this table.

CREATE TABLE IF NOT EXISTS notification_sms_deliveries (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  provider TEXT,
  message_id TEXT,
  subject TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  next_retry_at TEXT,
  error_category TEXT,
  last_attempt_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_sms_dedupe_key
  ON notification_sms_deliveries (dedupe_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_sms_notification_recipient
  ON notification_sms_deliveries (notification_id, recipient);

CREATE INDEX IF NOT EXISTS idx_notification_sms_notification_id
  ON notification_sms_deliveries (notification_id);

CREATE INDEX IF NOT EXISTS idx_notification_sms_retry
  ON notification_sms_deliveries (status, next_retry_at, attempts);

CREATE INDEX IF NOT EXISTS idx_notification_sms_failed
  ON notification_sms_deliveries (status, updated_at DESC);
