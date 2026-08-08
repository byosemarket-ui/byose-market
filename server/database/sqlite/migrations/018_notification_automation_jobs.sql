-- Notification automation background job queue
CREATE TABLE IF NOT EXISTS notification_automation_jobs (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  notification_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  available_at TEXT NOT NULL,
  started_at TEXT,
  processed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_automation_dedupe
  ON notification_automation_jobs (dedupe_key);

CREATE INDEX IF NOT EXISTS idx_notification_automation_pending
  ON notification_automation_jobs (status, available_at, created_at);

CREATE INDEX IF NOT EXISTS idx_notification_automation_event
  ON notification_automation_jobs (event_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_automation_notification
  ON notification_automation_jobs (notification_id);
