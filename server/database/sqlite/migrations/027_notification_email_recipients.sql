-- Per-recipient admin email delivery (Recipient 1 / Recipient 2)
-- Existing unique(notification_id) blocked a second inbox for the same notification.

DROP INDEX IF EXISTS idx_notification_email_notification_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_email_notification_recipient
  ON notification_email_deliveries (notification_id, recipient);

CREATE INDEX IF NOT EXISTS idx_notification_email_notification_id
  ON notification_email_deliveries (notification_id);
