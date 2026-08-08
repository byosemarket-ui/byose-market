-- Notification operations logs for monitoring, auditing, and recovery visibility
CREATE TABLE IF NOT EXISTS notification_ops_logs (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'info',
  channel TEXT NOT NULL DEFAULT 'system',
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  related_notification_id TEXT,
  related_job_id TEXT,
  related_delivery_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_ops_created
  ON notification_ops_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_ops_event_status
  ON notification_ops_logs (event_type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_ops_channel
  ON notification_ops_logs (channel, created_at DESC);
