-- Admin notification email delivery log (dedupe + retry)
CREATE TABLE IF NOT EXISTS notification_email_deliveries (
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
  next_retry_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_email_notification_id
  ON notification_email_deliveries (notification_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_email_dedupe_key
  ON notification_email_deliveries (dedupe_key);

CREATE INDEX IF NOT EXISTS idx_notification_email_retry
  ON notification_email_deliveries (status, next_retry_at, attempts);
