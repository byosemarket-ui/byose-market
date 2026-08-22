#!/usr/bin/env node
/**
 * STEP 5 — unified customer notification system verification.
 *
 * Run: node scripts/verify-customer-notifications-system.js
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function checkSourceGuards() {
  const dashboard = read('account/js/dashboard-data.js');
  const accountHtml = read('account/account.html');
  const css = read('account/css/account-mobile.css');
  const service = read('server/services/customernotificationdataservice.js');
  const repo = read('server/repositories/sqlite/customer-notification.repository.js');
  const controller = read('server/controllers/customernotificationscontroller.js');

  assert(dashboard.includes('syncNotifications'), 'dashboard uses centralized notification sync');
  assert(dashboard.includes('startNotificationPolling'), 'dashboard polls for notification updates');
  assert(dashboard.includes('resolveNotificationDestination'), 'dashboard validates notification destinations');
  assert(dashboard.includes('formatNotificationTypeLabel'), 'dashboard distinguishes notification types in UI');
  assert(dashboard.includes('mapNotificationItem'), 'dashboard uses one notification mapping helper');
  assert(dashboard.includes('Load more notifications'), 'dashboard supports paginated loading');
  assert(!dashboard.includes('setInterval(() => {\n      syncNotifications({ silent: true }).catch(() => {});\n      syncNotifications'), 'dashboard must not recursively trigger sync loops');

  assert(accountHtml.includes('notificationStatus'), 'account page includes notification status element');
  assert(accountHtml.includes('loadMoreNotifications'), 'account page includes load-more control');
  assert(accountHtml.includes('notification-panel-body'), 'notification list scroll area is isolated from header');
  assert(dashboard.includes('lockPageScroll'), 'dashboard locks page scroll when notification panel is open');
  assert(css.includes('.notification-panel-body'), 'notification panel body scroll region exists');
  assert(css.includes('overflow: hidden'), 'notification overlay must not scroll as a whole');

  assert(css.includes('.notification-status'), 'notification status styles exist');
  assert(css.includes('z-index: 10050'), 'notification overlay remains above account content');

  assert(service.includes('hasMore'), 'notification service returns pagination metadata');
  assert(repo.includes('countForUser'), 'notification repository tracks total count');
  assert(repo.includes('OFFSET ?'), 'notification repository supports pagination offset');
  assert(controller.includes('req.query.offset'), 'notification API accepts offset pagination');
}

function request(baseUrl, method, routePath, { token = '', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(routePath, `${baseUrl}/`);
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw); } catch (_error) { json = null; }
        resolve({ status: res.statusCode || 0, json, raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function resolveUserRecordId(db, publicId) {
  const row = db.prepare('SELECT id FROM users WHERE public_id = ? LIMIT 1').get(String(publicId || '').trim());
  return Number(row?.id || 0);
}

async function seedNotification(userId, fields) {
  const { getClient } = require('../server/database/sqlite/client');
  const db = getClient();
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO customer_notifications (user_id, type, title, body, deeplink, entity_type, entity_id, dedupe_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Number(userId),
    fields.type,
    fields.title,
    fields.body,
    fields.deeplink,
    fields.entityType,
    fields.entityId,
    fields.dedupeKey,
    now
  );
  return Number(result.lastInsertRowid);
}

async function runHttpScenarios() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byose-notify-system-'));
  const tmpDb = path.join(tmpDir, 'notify-system.sqlite');
  process.env.NODE_ENV = 'test';
  process.env.DB_CLIENT = 'sqlite';
  process.env.SQLITE_DB_PATH = tmpDb;
  process.env.JWT_SECRET = 'notify-system-secret';
  process.env.ADMIN_EMAIL = 'admin@example.com';

  const { connectDatabase, closeDatabase } = require('../server/database');
  await connectDatabase();

  const express = require('express');
  const createApiRouter = require('../server/api');
  const { generateToken } = require('../server/utils/token');
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', createApiRouter());

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const stamp = Date.now();
    const signupA = await request(baseUrl, 'POST', '/api/auth/signup', {
      body: { name: 'System Owner', email: `system.a.${stamp}@example.com`, phone: `+25079${String(stamp).slice(-7)}`, password: 'NotifyPass1' }
    });
    const signupB = await request(baseUrl, 'POST', '/api/auth/signup', {
      body: { name: 'System Other', email: `system.b.${stamp}@example.com`, phone: `+25078${String(stamp).slice(-7)}`, password: 'NotifyPass1' }
    });
    assert(signupA.status === 200 && signupB.status === 200, 'customer signup failed');

    const tokenA = signupA.json.token;
    const tokenB = signupB.json.token;
    const adminToken = generateToken({ id: 'ADMIN_TEST', email: process.env.ADMIN_EMAIL, role: 'admin', sid: 'sess_notify_system' });

    const { getClient } = require('../server/database/sqlite/client');
    const db = getClient();
    const userAId = resolveUserRecordId(db, signupA.json?.user?.id);
    const userBId = resolveUserRecordId(db, signupB.json?.user?.id);

    for (let index = 0; index < 25; index += 1) {
      await seedNotification(userAId, {
        type: 'SYSTEM',
        title: `System message ${index}`,
        body: `Body ${index}`,
        deeplink: '/account/account.html',
        entityType: 'system',
        entityId: `sys-${index}`,
        dedupeKey: `SYSTEM:${userAId}:sys-${index}`
      });
    }

    const page1 = await request(baseUrl, 'GET', '/api/customer-notifications?limit=10&offset=0', { token: tokenA });
    assert(page1.status === 200 && page1.json?.success, 'paginated list failed');
    assert(page1.json.items.length === 10, 'first page must return 10 notifications');
    assert(page1.json.hasMore === true, 'hasMore must be true when more notifications exist');
    assert(Number(page1.json.total) === 25, 'total count must reflect all notifications');
    assert(Number(page1.json.unreadCount) === 25, 'unread count must remain authoritative');

    const page3 = await request(baseUrl, 'GET', '/api/customer-notifications?limit=10&offset=20', { token: tokenA });
    assert(page3.json.items.length === 5, 'final page must return remaining notifications');
    assert(page3.json.hasMore === false, 'hasMore must be false on final page');

    const firstPageNewest = page1.json.items[0]?.title;
    const secondPage = await request(baseUrl, 'GET', '/api/customer-notifications?limit=10&offset=10', { token: tokenA });
    assert(secondPage.json.items[0]?.title !== firstPageNewest, 'pagination must preserve newest-first ordering across pages');

    const adminSend = await request(baseUrl, 'POST', '/api/admin/customer-notifications', {
      token: adminToken,
      body: {
        customerId: signupA.json?.user?.id,
        title: 'Direct admin message',
        message: 'Hello Customer A',
        category: 'account',
        idempotencyKey: `system-${stamp}`
      }
    });
    assert(adminSend.status === 201 && adminSend.json?.success, 'admin direct message failed');

    const listB = await request(baseUrl, 'GET', '/api/customer-notifications?limit=5', { token: tokenB });
    assert(!(listB.json.items || []).some((item) => item.title === 'Direct admin message'), 'customer B must not receive customer A admin message');

    const listA = await request(baseUrl, 'GET', '/api/customer-notifications?limit=5', { token: tokenA });
    assert((listA.json.items || []).some((item) => item.title === 'Direct admin message'), 'customer A must receive admin direct message');

    const crossRead = await request(baseUrl, 'POST', '/api/customer-notifications/1/read', { token: tokenB });
    assert(crossRead.status === 200, 'cross-customer mark-read must not error');
    const ownerUnread = await request(baseUrl, 'GET', '/api/customer-notifications?limit=1', { token: tokenA });
    assert(Number(ownerUnread.json?.unreadCount) === 26, 'cross-customer mark-read must not affect owner unread count');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_error) { /* ignore */ }
  }
}

function runRegressionScript(scriptName) {
  const scriptPath = path.join(root, 'scripts', scriptName);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    env: { ...process.env },
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    failures.push(`${scriptName} failed:\n${result.stdout || ''}\n${result.stderr || ''}`.trim());
  }
}

async function main() {
  checkSourceGuards();
  await runHttpScenarios();

  runRegressionScript('verify-customer-notifications.js');
  runRegressionScript('verify-order-status-notifications.js');
  runRegressionScript('verify-admin-customer-notifications.js');
  runRegressionScript('verify-new-product-notifications.js');

  if (failures.length) {
    console.error('verify-customer-notifications-system FAILED');
    failures.forEach((message) => console.error(` - ${message}`));
    process.exit(1);
  }

  console.log('verify-customer-notifications-system OK');
}

main().catch((error) => {
  console.error('verify-customer-notifications-system crashed:', error);
  process.exit(1);
});
