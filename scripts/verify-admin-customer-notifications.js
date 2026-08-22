#!/usr/bin/env node
/**
 * Admin → customer notification verification.
 *
 * Run: node scripts/verify-admin-customer-notifications.js
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
  const controller = read('server/controllers/admincustomernotificationscontroller.js');
  const routes = read('server/routes/admincustomernotifications.js');
  const service = read('server/services/customernotificationdataservice.js');
  const api = read('server/api/index.js');
  const adminPage = read('admin/app/pages/customer-notifications-send.js');
  const nav = read('admin/app/core/navigation.js');
  const main = read('admin/app/main.js');

  assert(routes.includes('adminAccessDisabled'), 'admin customer notification routes require admin auth');
  assert(controller.includes('findUserByIdentifier'), 'controller resolves customer server-side');
  assert(controller.includes('verifyOrderBelongsToCustomer'), 'controller validates order ownership');
  assert(controller.includes('verifyProductExists'), 'controller validates related product');
  assert(controller.includes('Notification title is required'), 'controller validates title');
  assert(controller.includes('Notification message is required'), 'controller validates message');
  assert(service.includes('sendAdminCustomerNotification'), 'service exposes admin send helper');
  assert(service.includes('ADMIN_MSG:'), 'admin send uses dedupe keys for idempotency');
  assert(api.includes('/admin/customer-notifications'), 'API mounts admin customer notification route');
  assert(adminPage.includes('sendCustomerNotification'), 'admin page calls send API');
  assert(adminPage.includes('idempotencyKey'), 'admin page sends idempotency key');
  assert(nav.includes('customernotifications'), 'admin navigation includes customer notifications page');
  assert(main.includes('customernotifications'), 'admin router registers customer notifications page');
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

async function createCustomer(baseUrl, label, stamp) {
  const email = `${label}.${stamp}@example.com`;
  const phone = label === 'target'
    ? `+25079${String(stamp).slice(-7)}`
    : `+25078${String(stamp).slice(-7)}`;
  const signup = await request(baseUrl, 'POST', '/api/auth/signup', {
    body: { name: `Admin Notify ${label.toUpperCase()}`, email, phone, password: 'NotifyPass1' }
  });
  assert(signup.status === 200 && signup.json?.success, `${label} signup failed: ${signup.raw}`);
  return {
    token: signup.json.token,
    publicId: signup.json?.user?.id || signup.json?.user?.publicId
  };
}

async function createOrder(baseUrl, token, orderId, catalogId, phone) {
  const shipping = {
    fullName: 'Admin Notify Customer',
    phone,
    provinceCity: 'Kigali',
    district: 'Gasabo',
    sector: 'Kacyiru',
    cell: 'Kamatamu',
    village: 'Rugando'
  };
  const response = await request(baseUrl, 'POST', '/api/orders', {
    token,
    body: {
      orderId,
      paymentMethod: 'cod',
      items: [{ productId: String(catalogId), quantity: 1, price: 1500, name: 'Admin Notify Item' }],
      shippingAddress: shipping,
      customerName: shipping.fullName,
      customerPhone: phone
    }
  });
  assert(response.status === 200 || response.status === 201, `order create failed for ${orderId}: ${response.raw}`);
}

async function adminSend(baseUrl, adminToken, payload) {
  return request(baseUrl, 'POST', '/api/admin/customer-notifications', {
    token: adminToken,
    body: payload
  });
}

async function listCustomerNotifications(baseUrl, token) {
  return request(baseUrl, 'GET', '/api/customer-notifications?limit=20', { token });
}

async function markRead(baseUrl, token, notificationId) {
  return request(baseUrl, 'POST', `/api/customer-notifications/${encodeURIComponent(notificationId)}/read`, { token });
}

async function runHttpScenarios() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byose-admin-customer-notify-'));
  const tmpDb = path.join(tmpDir, 'admin-customer-notify.sqlite');
  process.env.NODE_ENV = 'test';
  process.env.DB_CLIENT = 'sqlite';
  process.env.SQLITE_DB_PATH = tmpDb;
  process.env.JWT_SECRET = 'admin-customer-notify-secret';
  process.env.ADMIN_EMAIL = 'admin@example.com';

  const { connectDatabase, closeDatabase } = require('../server/database');
  await connectDatabase();

  const express = require('express');
  const createApiRouter = require('../server/api');
  const { generateToken } = require('../server/utils/token');
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
    const customerA = await createCustomer(baseUrl, 'target', stamp);
    const customerB = await createCustomer(baseUrl, 'other', stamp);
    const adminToken = generateToken({
      id: 'ADMIN_TEST',
      email: process.env.ADMIN_EMAIL,
      role: 'admin',
      sid: 'sess_admin_customer_notify'
    });

    const { getClient } = require('../server/database/sqlite/client');
    const db = getClient();
    const catalogId = 940000 + Math.floor(Math.random() * 1000);
    db.prepare(`
      INSERT INTO products (
        catalog_id, category_slug, name, title, price, stock, variants_json, metadata_json, status, visibility
      ) VALUES (?, 'general', ?, ?, 1500, 20, '{}', '{}', 'active', 'both')
    `).run(catalogId, 'Admin Notify Product', 'Admin Notify Product');

    const orderA = `ORD-ADMIN-NOTIFY-A-${stamp}`;
    const orderB = `ORD-ADMIN-NOTIFY-B-${stamp}`;
    const phoneA = `+25079${String(stamp).slice(-7)}`;
    const phoneB = `+25078${String(stamp).slice(-7)}`;
    await createOrder(baseUrl, customerA.token, orderA, catalogId, phoneA);
    await createOrder(baseUrl, customerB.token, orderB, catalogId, phoneB);

    const idempotencyKey = `admin-test-${stamp}`;

    const unauthorized = await adminSend(baseUrl, customerA.token, {
      customerId: customerA.publicId,
      title: 'Should fail',
      message: 'Customer must not send admin notifications.'
    });
    assert(unauthorized.status === 401 || unauthorized.status === 403, 'customer token must not access admin send API');

    const emptyTitle = await adminSend(baseUrl, adminToken, {
      customerId: customerA.publicId,
      title: '   ',
      message: 'Missing title'
    });
    assert(emptyTitle.status === 400, 'empty title must be rejected');

    const emptyMessage = await adminSend(baseUrl, adminToken, {
      customerId: customerA.publicId,
      title: 'Valid title',
      message: '   '
    });
    assert(emptyMessage.status === 400, 'empty message must be rejected');

    const invalidOrder = await adminSend(baseUrl, adminToken, {
      customerId: customerA.publicId,
      title: 'Invalid order link',
      message: 'This should fail because order belongs to another customer.',
      orderId: orderB
    });
    assert(invalidOrder.status === 400, 'order that does not belong to customer must be rejected');

    const invalidCustomer = await adminSend(baseUrl, adminToken, {
      customerId: 'BM99999999',
      title: 'Missing customer',
      message: 'Should fail'
    });
    assert(invalidCustomer.status === 404, 'invalid customer must return 404');

    const send = await adminSend(baseUrl, adminToken, {
      customerId: customerA.publicId,
      title: 'Account update from BYOSE Market',
      message: 'Your profile details were reviewed by our team.',
      category: 'account',
      orderId: orderA,
      productId: String(catalogId),
      idempotencyKey
    });
    assert(send.status === 201 && send.json?.success, `admin send failed: ${send.raw}`);
    assert(String(send.json?.message || '').toLowerCase().includes('success'), 'admin send should return success message');

    const duplicate = await adminSend(baseUrl, adminToken, {
      customerId: customerA.publicId,
      title: 'Account update from BYOSE Market',
      message: 'Your profile details were reviewed by our team.',
      category: 'account',
      orderId: orderA,
      productId: String(catalogId),
      idempotencyKey
    });
    assert(duplicate.status === 201 && duplicate.json?.success, 'duplicate idempotency key should still succeed');
    assert(Number(duplicate.json?.notification?.id) === Number(send.json?.notification?.id), 'duplicate idempotency key must not create a second notification');

    const listA = await listCustomerNotifications(baseUrl, customerA.token);
    assert(listA.status === 200 && listA.json?.success, 'customer A list failed');
    assert(Number(listA.json?.unreadCount || 0) >= 1, 'customer A unread badge must include admin notification');
    const notification = (listA.json.items || []).find((item) => item.title === 'Account update from BYOSE Market');
    assert(notification, 'customer A should receive the admin notification');
    assert(!notification.isRead, 'admin notification should start unread');
    assert(String(notification.deeplink || '').includes(encodeURIComponent(orderA)), 'order deeplink should be stored when order is linked');

    const listB = await listCustomerNotifications(baseUrl, customerB.token);
    assert(listB.status === 200 && listB.json?.success, 'customer B list failed');
    assert(!(listB.json.items || []).some((item) => item.title === 'Account update from BYOSE Market'), 'customer B must not receive customer A notification');

    const mark = await markRead(baseUrl, customerA.token, notification.id);
    assert(mark.status === 200 && mark.json?.success, 'mark read failed');
    const refreshed = (mark.json.items || []).find((item) => Number(item.id) === Number(notification.id));
    assert(refreshed?.isRead, 'opening notification should mark it read');

    const userAId = resolveUserRecordId(db, customerA.publicId);
    const userBId = resolveUserRecordId(db, customerB.publicId);
    const rowsA = db.prepare('SELECT COUNT(*) AS total FROM customer_notifications WHERE user_id = ?').get(userAId);
    const rowsB = db.prepare('SELECT COUNT(*) AS total FROM customer_notifications WHERE user_id = ?').get(userBId);
    assert(Number(rowsA.total) === 1, 'customer A should have exactly one admin notification persisted');
    assert(Number(rowsB.total) === 0, 'customer B should have zero admin notifications persisted');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_error) { /* ignore */ }
  }
}

async function main() {
  checkSourceGuards();
  await runHttpScenarios();

  if (failures.length) {
    console.error('verify-admin-customer-notifications FAILED');
    failures.forEach((message) => console.error(` - ${message}`));
    process.exit(1);
  }

  console.log('verify-admin-customer-notifications OK');
}

main().catch((error) => {
  console.error('verify-admin-customer-notifications crashed:', error);
  process.exit(1);
});
