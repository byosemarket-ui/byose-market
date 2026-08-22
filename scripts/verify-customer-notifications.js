#!/usr/bin/env node
/**
 * Customer notification center verification.
 * Uses a temporary SQLite database.
 *
 * Run: node scripts/verify-customer-notifications.js
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function checkSourceGuards() {
  const accountHtml = read('account/account.html');
  const dashboardJs = read('account/js/dashboard-data.js');
  const css = read('account/css/account-mobile.css');
  const routes = read('server/routes/customernotifications.js');
  const repo = read('server/repositories/sqlite/customer-notification.repository.js');

  assert(accountHtml.includes('notificationOverlay'), 'account page uses notification overlay');
  assert(accountHtml.includes('notificationDetailView'), 'account page includes notification detail view');
  assert(!accountHtml.includes('id="notificationPanel" class="notification-panel" aria-label="Notifications" hidden>'), 'notification panel must not stay inside header dropdown');

  assert(dashboardJs.includes('fetchServerNotifications'), 'dashboard loads server notifications');
  assert(dashboardJs.includes('markNotificationRead'), 'dashboard marks individual notifications read');
  assert(dashboardJs.includes('markAllNotificationsRead'), 'dashboard marks all notifications read');
  assert(dashboardJs.includes('updateNotificationBadge'), 'dashboard updates unread badge from server count');
  assert(dashboardJs.includes('buildAccountTips'), 'account tips are separate from unread badge count');
  assert(dashboardJs.includes('notificationOverlay'), 'dashboard binds overlay close behavior');

  assert(css.includes('.notification-overlay'), 'notification overlay styles exist');
  assert(css.includes('z-index: 10050'), 'notification overlay sits above account content');

  assert(routes.includes('authMiddleware'), 'customer notification routes require auth');
  assert(repo.includes('WHERE user_id = ?'), 'notification repository scopes by authenticated user');
  assert(repo.includes('read_at IS NULL'), 'notification repository tracks unread state');
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

async function seedNotification(userId, title, dedupeKey) {
  const { getClient } = require('../server/database/sqlite/client');
  const db = getClient();
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO customer_notifications (user_id, type, title, body, deeplink, entity_type, entity_id, dedupe_key, created_at)
    VALUES (?, 'SYSTEM', ?, ?, '/account/account.html', 'system', 'test', ?, ?)
  `).run(Number(userId), title, `${title} body`, dedupeKey, now);

  return Number(result.lastInsertRowid);
}

function resolveUserRecordId(db, publicId) {
  const row = db.prepare('SELECT id FROM users WHERE public_id = ? LIMIT 1').get(String(publicId || '').trim());
  return Number(row?.id || 0);
}

async function runHttpScenarios() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byose-customer-notifications-'));
  const tmpDb = path.join(tmpDir, 'notifications.sqlite');
  process.env.SQLITE_DB_PATH = tmpDb;
  process.env.DB_CLIENT = 'sqlite';
  process.env.JWT_SECRET = 'customer-notifications-verify-secret';
  process.env.NODE_ENV = 'test';

  const { connectDatabase, closeDatabase } = require('../server/database');
  await connectDatabase();

  const express = require('express');
  const createApiRouter = require('../server/api');
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', createApiRouter());

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const stamp = Date.now();
    const password = 'NotifyPass1';
    const emailA = `notify.owner.${stamp}@example.com`;
    const emailB = `notify.other.${stamp}@example.com`;

    const signupA = await request(baseUrl, 'POST', '/api/auth/signup', {
      body: { name: 'Notify Owner', email: emailA, phone: '+250780000401', password }
    });
    assert(signupA.status === 200 && signupA.json?.success, `owner signup failed: ${signupA.raw}`);
    const tokenA = signupA.json?.token || '';

    const signupB = await request(baseUrl, 'POST', '/api/auth/signup', {
      body: { name: 'Notify Other', email: emailB, phone: '+250780000402', password }
    });
    assert(signupB.status === 200 && signupB.json?.success, `other signup failed: ${signupB.raw}`);
    const tokenB = signupB.json?.token || '';
    const { getClient } = require('../server/database/sqlite/client');
    const db = getClient();
    const userAId = resolveUserRecordId(db, signupA.json?.user?.id || signupA.json?.user?.publicId);
    const userBId = resolveUserRecordId(db, signupB.json?.user?.id || signupB.json?.user?.publicId);
    assert(userAId > 0 && userBId > 0, 'test users must resolve to database ids');

    const idA1 = await seedNotification(userAId, 'First update', `dedupe-a1-${stamp}`);
    const idA2 = await seedNotification(userAId, 'Second update', `dedupe-a2-${stamp}`);
    await seedNotification(userBId, 'Other customer update', `dedupe-b1-${stamp}`);

    const guestList = await request(baseUrl, 'GET', '/api/customer-notifications');
    assert(guestList.status === 401, 'guest cannot list customer notifications');

    const listA = await request(baseUrl, 'GET', '/api/customer-notifications', { token: tokenA });
    assert(listA.status === 200 && listA.json?.success, 'owner can list notifications');
    assert(Array.isArray(listA.json?.items) && listA.json.items.length === 2, 'owner sees only own notifications');
    assert(Number(listA.json?.unreadCount) === 2, 'owner unread count starts at 2');

    const listB = await request(baseUrl, 'GET', '/api/customer-notifications', { token: tokenB });
    assert(listB.json?.items?.length === 1, 'other customer sees only one notification');
    assert(listB.json?.items?.[0]?.title === 'Other customer update', 'other customer notification is isolated');

    const markOne = await request(baseUrl, 'POST', `/api/customer-notifications/${idA1}/read`, { token: tokenA });
    assert(markOne.status === 200 && markOne.json?.success, 'owner can mark one notification read');
    assert(Number(markOne.json?.unreadCount) === 1, 'mark one read reduces unread count by one');
    assert(markOne.json?.items?.find((item) => item.id === idA1)?.isRead === true, 'marked notification is read');
    assert(markOne.json?.items?.find((item) => item.id === idA2)?.isRead === false, 'other notification stays unread');

    const stealRead = await request(baseUrl, 'POST', `/api/customer-notifications/${idA2}/read`, { token: tokenB });
    assert(stealRead.status === 200 && stealRead.json?.success, 'cross-user mark read request is handled safely');
    assert(Number(stealRead.json?.unreadCount) === 1, 'other customer unread count unchanged after failed cross-user mark');

    const ownerAfterSteal = await request(baseUrl, 'GET', '/api/customer-notifications', { token: tokenA });
    assert(ownerAfterSteal.json?.items?.find((item) => item.id === idA2)?.isRead === false, 'owner notification remains unread when another customer attempts to mark it');

    const markAll = await request(baseUrl, 'POST', '/api/customer-notifications/read-all', { token: tokenA });
    assert(markAll.status === 200 && markAll.json?.success, 'owner can mark all notifications read');
    assert(Number(markAll.json?.unreadCount) === 0, 'mark all read clears unread count');
    assert((markAll.json?.items || []).every((item) => item.isRead === true), 'all owner notifications become read');

    const refreshA = await request(baseUrl, 'GET', '/api/customer-notifications', { token: tokenA });
    assert(Number(refreshA.json?.unreadCount) === 0, 'unread count stays zero after refresh');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await closeDatabase().catch(() => {});
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_error) {
      // ignore cleanup errors on Windows locks
    }
  }
}

async function main() {
  checkSourceGuards();
  await runHttpScenarios();

  if (failures.length) {
    console.error('Customer notification verification failed:');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('Customer notification verification passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
