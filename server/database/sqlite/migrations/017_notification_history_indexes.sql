-- Notification history query performance indexes
CREATE INDEX IF NOT EXISTS idx_admin_notifications_created_at
  ON admin_notifications (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_priority_created
  ON admin_notifications (priority, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_type_created
  ON admin_notifications (type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_order_created
  ON admin_notifications (related_order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_customer_created
  ON admin_notifications (related_customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_created_date
  ON admin_notifications (created_date DESC);
