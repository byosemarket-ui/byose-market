#!/usr/bin/env node
/**
 * STEP 4 — Notification reliability, retry, and monitoring verification.
 * Run: node scripts/verify-notification-reliability.js
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];

function assert(condition, message) {
    if (!condition) failures.push(message);
}

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function checkSource() {
    const email = read('server/services/email/notification-email.service.js');
    const provider = read('server/services/email/email-provider.service.js');
    const repo = read('server/repositories/sqlite/notification-email-delivery.repository.js');
    const routes = read('server/routes/adminnotifications.js');
    const controller = read('server/controllers/adminnotificationscontroller.js');
    const monitoring = read('server/services/notification-monitoring.service.js');
    const ui = read('admin/app/pages/notifications-monitoring.js');
    const settings = read('server/services/notificationsettings.service.js');
    const order = read('server/controllers/ordercontroller.js');
    const dpo = read('server/services/dpopayment.service.js');
    const auth = read('server/middleware/adminaccessdisabled.js');
    const migration = read('server/database/sqlite/migrations/028_notification_email_reliability.sql');

    assert(provider.includes('function classifyEmailError'), 'SMTP errors must be classified temporary vs permanent');
    assert(email.includes('retryEmailDelivery'), 'manual retry must reuse the existing delivery row');
    assert(email.includes('Never creates a new ORDER_CREATED'), 'retry must not create a duplicate event');
    assert(email.includes("status === 'sent'"), 'already-sent deliveries must not be resent as a new event');
    assert(repo.includes("status = 'pending'"), 'automatic retry must only pick pending rows with a due next_retry_at');
    assert(repo.includes('next_retry_at IS NOT NULL'), 'failed permanent rows without next_retry_at must not loop forever');
    assert(repo.includes('includeStuck'), 'restart recovery must pick stuck pending deliveries');
    assert(email.includes('inFlightDeliveries'), 'concurrent sends of the same delivery must be locked');
    assert(email.includes('includeStuck: true'), 'boot/recovery must reprocess stuck pending emails');
    assert(migration.includes('error_category'), 'delivery diagnostics must persist in SQLite');
    assert(migration.includes('last_attempt_at'), 'last attempt time must persist across VPS restarts');
    assert(routes.includes("router.use(adminAccessDisabled)"), 'notification APIs must require admin auth');
    assert(auth.includes("require('./requireadminauth')"), 'adminAccessDisabled must be the existing admin auth middleware');
    assert(routes.includes('/monitoring/deliveries/:id/retry'), 'monitoring retry route must exist');
    assert(controller.includes('retryEmailDelivery'), 'retry controller must exist');
    assert(
        routes.indexOf('/monitoring/deliveries/:id/retry') < routes.indexOf("router.get('/:id'"),
        'retry route must be registered before generic /:id'
    );
    assert(monitoring.includes('recentDeliveries'), 'monitoring dashboard must include recent deliveries');
    assert(monitoring.includes('failedDeliveries'), 'monitoring dashboard must include failures');
    assert(monitoring.includes('retryingEmails'), 'monitoring metrics must include retrying count');
    assert(ui.includes('data-nm-retry'), 'monitoring UI must expose Retry');
    assert(ui.includes('Recent Notifications'), 'monitoring UI must show recent notifications');
    assert(ui.includes('Failures'), 'monitoring UI must show failures');
    assert(!ui.includes('SMS Service'), 'monitoring UI must not show Admin SMS health');
    assert(settings.includes('Test email sent successfully.'), 'test email success must report the real send result');
    assert(settings.includes("new Error('Test email failed.')"), 'test email failure must not be reported as success');
    assert(order.includes('notificationEngine.notifyOrderCreated(order)'), 'order create still notifies after persist');
    assert(order.includes('.catch((engineError)'), 'order create must not fail when notification fails');
    assert(dpo.includes('notifyPaymentChange'), 'payment notify remains server-side after save');
    assert(dpo.includes('dpo.payment.notify_failed'), 'payment remains intact if notify throws');
    assert(!email.includes('EMAIL_PASS'), 'email delivery logs must not include SMTP passwords');
    assert(provider.includes('[redacted]'), 'provider errors must redact secrets');
}

function checkSqliteRetryPersistence() {
    let Database;
    try {
        Database = require('better-sqlite3');
    } catch (_error) {
        failures.push('better-sqlite3 is required to verify delivery persistence');
        return;
    }

    const db = new Database(':memory:');
    try {
        db.exec(read('server/database/sqlite/migrations/016_notification_email_deliveries.sql'));
        db.exec(read('server/database/sqlite/migrations/027_notification_email_recipients.sql'));
        db.exec(read('server/database/sqlite/migrations/028_notification_email_reliability.sql'));

        const insert = db.prepare(`
            INSERT INTO notification_email_deliveries (
                id, notification_id, event_key, dedupe_key, recipient, status,
                attempts, max_attempts, last_error, created_at, updated_at,
                next_retry_at, error_category, last_attempt_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const now = new Date().toISOString();
        const past = new Date(Date.now() - 60 * 1000).toISOString();
        const stale = new Date(Date.now() - 4 * 60 * 1000).toISOString();

        insert.run('ned_a', 'n1', 'ORDER_CREATED', 'order:n1:to:a@x.com', 'a@x.com', 'pending', 0, 5, null, now, now, null, null, null);
        insert.run('ned_b', 'n1', 'ORDER_CREATED', 'order:n1:to:b@x.com', 'b@x.com', 'failed', 1, 5, '550 mailbox', now, now, null, 'permanent', now);
        insert.run('ned_c', 'n2', 'PAYMENT_RECEIVED', 'pay:n2:to:a@x.com', 'a@x.com', 'pending', 2, 5, 'timeout', now, now, past, 'temporary', now);
        insert.run('ned_d', 'n3', 'ORDER_CREATED', 'order:n3:to:a@x.com', 'a@x.com', 'pending', 0, 5, null, stale, stale, null, null, null);
        insert.run('ned_e', 'n4', 'ORDER_CREATED', 'order:n4:to:a@x.com', 'a@x.com', 'sent', 1, 5, null, now, now, null, null, now);

        const due = db.prepare(`
            SELECT id FROM notification_email_deliveries
            WHERE status = 'pending'
              AND attempts < max_attempts
              AND next_retry_at IS NOT NULL
              AND next_retry_at <= ?
        `).all(now).map((row) => row.id);
        assert(
            due.includes('ned_c') && !due.includes('ned_a') && !due.includes('ned_b') && !due.includes('ned_e'),
            'automatic retry must pick due temporary failures only'
        );

        const stuck = db.prepare(`
            SELECT id FROM notification_email_deliveries
            WHERE status = 'pending'
              AND attempts = 0
              AND next_retry_at IS NULL
              AND created_at <= ?
        `).all(stale).map((row) => row.id);
        assert(stuck.includes('ned_d') && !stuck.includes('ned_a'), 'restart recovery must pick aged never-sent rows without retrying in-flight sends');

        const n1Count = db.prepare(`SELECT COUNT(*) AS total FROM notification_email_deliveries WHERE notification_id = 'n1'`).get();
        assert(Number(n1Count.total) === 2, 'one notification must store a delivery row per recipient');

        db.prepare(`
            UPDATE notification_email_deliveries
            SET status = 'pending', next_retry_at = ?, max_attempts = 6
            WHERE id = 'ned_b'
        `).run(now);
        const afterRetry = db.prepare(`SELECT COUNT(*) AS total FROM notification_email_deliveries WHERE notification_id = 'n1'`).get();
        assert(Number(afterRetry.total) === 2, 'admin retry must update the existing failed row instead of inserting a duplicate event');

        let duplicateBlocked = false;
        try {
            insert.run('ned_dup', 'n1', 'ORDER_CREATED', 'order:n1:to:a@x.com', 'a@x.com', 'pending', 0, 5, null, now, now, null, null, null);
        } catch (_error) {
            duplicateBlocked = true;
        }
        assert(duplicateBlocked, 'duplicate recipient/dedupe inserts must be rejected by SQLite');

        const persisted = db.prepare(`
            SELECT error_category, last_attempt_at FROM notification_email_deliveries WHERE id = 'ned_b'
        `).get();
        assert(persisted.error_category === 'permanent' && Boolean(persisted.last_attempt_at), 'failure diagnostics must survive in SQLite');
    } finally {
        db.close();
    }
}

function checkClassification() {
    const { classifyEmailError } = require('../server/services/email/email-provider.service');

    const timeout = classifyEmailError({ message: 'Connection timed out', code: 'ETIMEDOUT' });
    assert(timeout.retryable === true && timeout.category === 'temporary', 'timeouts must be retryable');

    const reset = classifyEmailError({ message: 'read ECONNRESET', code: 'ECONNRESET' });
    assert(reset.retryable === true, 'connection resets must be retryable');

    const tempSmtp = classifyEmailError({ message: 'Try again later', responseCode: 421 });
    assert(tempSmtp.retryable === true, 'SMTP 421 must be retryable');

    const invalid = classifyEmailError({ message: 'Mailbox unavailable', responseCode: 550 });
    assert(invalid.retryable === false && invalid.category === 'permanent', 'invalid recipients must not retry forever');

    const auth = classifyEmailError({ message: 'Invalid login', code: 'EAUTH' });
    assert(auth.retryable === false, 'auth failures must be permanent');

    const config = classifyEmailError(new Error('Email provider is not configured'), { reason: 'provider_not_configured' });
    assert(config.retryable === false && config.category === 'config', 'missing SMTP config must not retry forever');

    const missing = classifyEmailError(new Error('Admin notification email is not configured'), { reason: 'missing_recipient' });
    assert(missing.retryable === false, 'missing recipient must be permanent');
}

function main() {
    checkSource();
    checkClassification();
    checkSqliteRetryPersistence();

    if (failures.length) {
        console.error('Notification reliability verification FAILED:');
        failures.forEach((item) => console.error(` - ${item}`));
        process.exit(1);
    }

    console.log('Notification reliability verification PASSED.');
    process.exit(0);
}

main();
