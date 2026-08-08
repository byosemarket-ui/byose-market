-- Admin in-app notification center foundation
CREATE TABLE IF NOT EXISTS admin_notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'system',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  related_order_id TEXT,
  related_customer_id TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'unread',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  created_date TEXT NOT NULL,
  created_time TEXT NOT NULL,
  read_at TEXT,
  archived_at TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_status_created
  ON admin_notifications (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_unread
  ON admin_notifications (status, deleted_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_type
  ON admin_notifications (type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_order
  ON admin_notifications (related_order_id);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_customer
  ON admin_notifications (related_customer_id);
