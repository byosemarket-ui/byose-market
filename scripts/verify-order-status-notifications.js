#!/usr/bin/env node
/**
 * Order status → customer notification verification.
 *
 * Run: node scripts/verify-order-status-notifications.js
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
  const service = read('server/services/customernotificationdataservice.js');
  const controller = read('server/controllers/ordercontroller.js');
  const dashboard = read('account/js/dashboard-data.js');

  assert(service.includes('notifyOrderStatusUpdate'), 'customer notification service exposes notifyOrderStatusUpdate');
  assert(service.includes('ORDER_STATUS:'), 'order status notifications use dedupe keys');
  assert(service.includes('order-details.html?id='), 'order status notifications deeplink to order details');
  assert(service.includes('has been confirmed'), 'confirmed status copy exists');
  assert(service.includes('is now being processed'), 'processing status copy exists');
  assert(service.includes('packed and is ready for shipping'), 'packed status copy exists');
  assert(service.includes('is on the way'), 'shipping status copy exists');
  assert(service.includes('is out for delivery'), 'out for delivery status copy exists');
  assert(service.includes('has been delivered successfully'), 'delivered status copy exists');

  assert(controller.includes('customerNotificationDataService.notifyOrderStatusUpdate'), 'admin status update triggers customer inbox notification');
  assert(
    controller.indexOf('database.order.save_status_admin')
      < controller.indexOf('customerNotificationDataService.notifyOrderStatusUpdate'),
    'customer notification must run after order save'
  );
  assert(
    controller.includes('oldStatusLower !== normalizeText(order.status || order.orderStatus).toLowerCase()'),
    'customer notification must only run on meaningful status transitions'
  );

  assert(dashboard.includes('normalizeDeeplink'), 'account notification UI resolves order deeplinks');
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
  const phone = label === 'ownera'
    ? `+25079${String(stamp).slice(-7)}`
    : `+25078${String(stamp).slice(-7)}`;
  const signup = await request(baseUrl, 'POST', '/api/auth/signup', {
    body: { name: `Notify ${label.toUpperCase()}`, email, phone, password: 'NotifyPass1' }
  });
  assert(signup.status === 200 && signup.json?.success, `${label} signup failed: ${signup.raw}`);
  return {
    token: signup.json.token,
    publicId: signup.json?.user?.id || signup.json?.user?.publicId
  };
}

async function createOrder(baseUrl, token, orderId, catalogId, phone) {
  const shipping = {
    fullName: 'Notify Customer',
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
      items: [{ productId: String(catalogId), quantity: 1, price: 1500, name: 'Notify Item' }],
      shippingAddress: shipping,
      customerName: shipping.fullName,
      customerPhone: phone
    }
  });
  assert(response.status === 200 || response.status === 201, `order create failed for ${orderId}: ${response.raw}`);
}

async function adminUpdateStatus(baseUrl, adminToken, orderId, status) {
  return request(baseUrl, 'PUT', `/api/admin/orders/${encodeURIComponent(orderId)}/status`, {
    token: adminToken,
    body: { status }
  });
}

async function listCustomerNotifications(baseUrl, token) {
  return request(baseUrl, 'GET', '/api/customer-notifications?limit=20', { token });
}

async function runHttpScenarios() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byose-order-status-notify-'));
  const tmpDb = path.join(tmpDir, 'order-status-notify.sqlite');
  process.env.NODE_ENV = 'test';
  process.env.DB_CLIENT = 'sqlite';
  process.env.SQLITE_DB_PATH = tmpDb;
  process.env.JWT_SECRET = 'order-status-notify-secret';
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
    const customerA = await createCustomer(baseUrl, 'ownera', stamp);
    const customerB = await createCustomer(baseUrl, 'ownerb', stamp);
    const adminToken = generateToken({
      id: 'ADMIN_TEST',
      email: process.env.ADMIN_EMAIL,
      role: 'admin',
      sid: 'sess_order_status_notify'
    });

    const { getClient } = require('../server/database/sqlite/client');
    const db = getClient();
    const catalogId = 930000 + Math.floor(Math.random() * 1000);
    db.prepare(`
      INSERT INTO products (
        catalog_id, category_slug, name, title, price, stock, variants_json, metadata_json, status, visibility
      ) VALUES (?, 'general', ?, ?, 1500, 20, '{}', '{}', 'active', 'both')
    `).run(catalogId, 'Notify Item', 'Notify Item');

    const orderA = `ORD-NOTIFY-A-${stamp}`;
    const orderB = `ORD-NOTIFY-B-${stamp}`;
    const phoneA = `+25079${String(stamp).slice(-7)}`;
    const phoneB = `+25078${String(stamp).slice(-7)}`;
    await createOrder(baseUrl, customerA.token, orderA, catalogId, phoneA);
    await createOrder(baseUrl, customerB.token, orderB, catalogId, phoneB);

    const transitions = [
      ['Confirmed', 'has been confirmed'],
      ['Processing', 'is now being processed'],
      ['Packed', 'packed and is ready for shipping'],
      ['Shipping', 'is on the way'],
      ['Delivered', 'has been delivered successfully']
    ];

    for (const [status, snippet] of transitions) {
      const update = await adminUpdateStatus(baseUrl, adminToken, orderA, status);
      assert(update.status === 200 && update.json?.success, `admin update to ${status} failed: ${update.raw}`);

      const list = await listCustomerNotifications(baseUrl, customerA.token);
      assert(list.status === 200 && list.json?.success, `customer A list failed after ${status}`);
      const match = (list.json.items || []).find((item) => String(item.body || '').includes(snippet));
      assert(match, `customer A should receive ${status} notification containing "${snippet}"`);
      assert(String(match.deeplink || '').includes(encodeURIComponent(orderA)), `${status} notification must deeplink to order A`);
    }

    const duplicate = await adminUpdateStatus(baseUrl, adminToken, orderA, 'Delivered');
    assert(duplicate.status === 200 && duplicate.json?.success, 'duplicate delivered update should still succeed');
    const afterDuplicate = await listCustomerNotifications(baseUrl, customerA.token);
    const deliveredMatches = (afterDuplicate.json.items || []).filter((item) => String(item.body || '').includes('has been delivered successfully'));
    assert(deliveredMatches.length === 1, 'duplicate same status must not create another delivered notification');

    const updateB = await adminUpdateStatus(baseUrl, adminToken, orderB, 'Confirmed');
    assert(updateB.status === 200 && updateB.json?.success, 'customer B order update failed');

    const listB = await listCustomerNotifications(baseUrl, customerB.token);
    const listA = await listCustomerNotifications(baseUrl, customerA.token);
    assert((listB.json.items || []).some((item) => String(item.body || '').includes(orderB)), 'customer B should see only their order notification');
    assert(!(listB.json.items || []).some((item) => String(item.body || '').includes(orderA)), 'customer B must not see customer A order notifications');
    assert((listA.json.items || []).some((item) => String(item.body || '').includes(orderA)), 'customer A notifications must remain intact');

    const userAId = resolveUserRecordId(db, customerA.publicId);
    const userBId = resolveUserRecordId(db, customerB.publicId);
    const rowsA = db.prepare('SELECT COUNT(*) AS total FROM customer_notifications WHERE user_id = ?').get(userAId);
    const rowsB = db.prepare('SELECT COUNT(*) AS total FROM customer_notifications WHERE user_id = ?').get(userBId);
    assert(Number(rowsA.total) === transitions.length, `customer A should have ${transitions.length} persisted notifications`);
    assert(Number(rowsB.total) === 1, 'customer B should have one persisted notification');
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
    console.error('Order status notification verification failed:');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('Order status notification verification passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
