-- Unified multi-channel notification delivery tracking
CREATE TABLE IF NOT EXISTS notification_channel_deliveries (
  id TEXT PRIMARY KEY,
  notification_id TEXT,
  event_key TEXT NOT NULL,
  channel TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  provider TEXT,
  message_id TEXT,
  recipient TEXT,
  subject TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  delivered_at TEXT,
  next_retry_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ncd_dedupe_channel
  ON notification_channel_deliveries (dedupe_key, channel);

CREATE INDEX IF NOT EXISTS idx_ncd_notification_channel
  ON notification_channel_deliveries (notification_id, channel);

CREATE INDEX IF NOT EXISTS idx_ncd_status_retry
  ON notification_channel_deliveries (status, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_ncd_event_created
  ON notification_channel_deliveries (event_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ncd_channel_status
  ON notification_channel_deliveries (channel, status, updated_at DESC);
