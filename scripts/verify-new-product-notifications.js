#!/usr/bin/env node
/**
 * New product publish → customer notification verification.
 *
 * Run: node scripts/verify-new-product-notifications.js
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkSourceGuards() {
  const service = read('server/services/customernotificationdataservice.js');
  const controller = read('server/controllers/productcontroller.js');

  assert(service.includes('NEW_PRODUCT'), 'customer notification service defines NEW_PRODUCT type');
  assert(service.includes('notifyNewProductPublished'), 'service exposes notifyNewProductPublished');
  assert(service.includes('broadcastNewProductPublished'), 'service exposes broadcastNewProductPublished');
  assert(service.includes('NEW_PRODUCT:${userId}:${catalogId}'), 'new product notifications use per-customer dedupe keys');
  assert(service.includes("title: 'New Product Available'"), 'new product notification title is defined');
  assert(service.includes('product-details1.html?id='), 'new product notifications deeplink to product details');

  assert(controller.includes('queueNewProductCustomerNotifications'), 'product controller queues new product customer notifications');
  assert(controller.includes('broadcastNewProductPublished'), 'product controller calls customer notification broadcast');
  assert(
    controller.indexOf('queueNewProductCustomerNotifications(product, null, logger)')
      > controller.indexOf('exports.createProduct'),
    'create product path must queue customer notifications after successful save'
  );
  assert(
    controller.indexOf('queueNewProductCustomerNotifications(product, existingProduct, logger)')
      > controller.indexOf('exports.updateProduct'),
    'update product path must queue customer notifications after successful save'
  );
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

async function createCustomer(baseUrl, label, stamp) {
  const email = `${label}.${stamp}@example.com`;
  const phone = label === 'buyera'
    ? `+25079${String(stamp).slice(-7)}`
    : `+25078${String(stamp).slice(-7)}`;
  const signup = await request(baseUrl, 'POST', '/api/auth/signup', {
    body: { name: `New Product ${label.toUpperCase()}`, email, phone, password: 'NotifyPass1' }
  });
  assert(signup.status === 200 && signup.json?.success, `${label} signup failed: ${signup.raw}`);
  return {
    token: signup.json.token,
    publicId: signup.json?.user?.id || signup.json?.user?.publicId
  };
}

async function adminCreateProduct(baseUrl, adminToken, payload) {
  return request(baseUrl, 'POST', '/api/admin/products', { token: adminToken, body: payload });
}

async function adminUpdateProduct(baseUrl, adminToken, catalogId, payload) {
  return request(baseUrl, 'PUT', `/api/admin/products/${encodeURIComponent(catalogId)}`, { token: adminToken, body: payload });
}

async function listCustomerNotifications(baseUrl, token) {
  return request(baseUrl, 'GET', '/api/customer-notifications?limit=30', { token });
}

async function markRead(baseUrl, token, notificationId) {
  return request(baseUrl, 'POST', `/api/customer-notifications/${encodeURIComponent(notificationId)}/read`, { token });
}

function productPayload(name, { publishStatus = 'active', price = 2500, stock = 12 } = {}) {
  const status = publishStatus === 'draft' ? 'draft' : (publishStatus === 'inactive' ? 'inactive' : 'active');
  return {
    name,
    title: name,
    price,
    stock,
    category: 'general',
    status,
    visibility: 'both',
    metadata: { publishStatus }
  };
}

async function runHttpScenarios() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byose-new-product-notify-'));
  const tmpDb = path.join(tmpDir, 'new-product-notify.sqlite');
  process.env.NODE_ENV = 'test';
  process.env.DB_CLIENT = 'sqlite';
  process.env.SQLITE_DB_PATH = tmpDb;
  process.env.JWT_SECRET = 'new-product-notify-secret';
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
    const customerA = await createCustomer(baseUrl, 'buyera', stamp);
    const customerB = await createCustomer(baseUrl, 'buyerb', stamp);
    const adminToken = generateToken({
      id: 'ADMIN_TEST',
      email: process.env.ADMIN_EMAIL,
      role: 'admin',
      sid: 'sess_new_product_notify'
    });

    const draftName = `Draft Product ${stamp}`;
    const draftCreate = await adminCreateProduct(baseUrl, adminToken, productPayload(draftName, { publishStatus: 'draft' }));
    assert(draftCreate.status === 201 && draftCreate.json?.success, `draft product create failed: ${draftCreate.raw}`);
    const draftCatalogId = draftCreate.json?.product?.catalogId || draftCreate.json?.product?.id;
    assert(draftCatalogId, 'draft product must return catalogId');

    await sleep(350);
    const draftListA = await listCustomerNotifications(baseUrl, customerA.token);
    assert(!(draftListA.json?.items || []).some((item) => String(item.body || '').includes(draftName)), 'draft product must not notify customers');

    const draftPublish = await adminUpdateProduct(baseUrl, adminToken, draftCatalogId, productPayload(draftName, { publishStatus: 'active' }));
    assert(draftPublish.status === 200 && draftPublish.json?.success, `draft publish failed: ${draftPublish.raw}`);

    await sleep(450);
    const afterPublishA = await listCustomerNotifications(baseUrl, customerA.token);
    const afterPublishB = await listCustomerNotifications(baseUrl, customerB.token);
    const matchA = (afterPublishA.json.items || []).find((item) => item.type === 'NEW_PRODUCT' && String(item.body || '').includes(draftName));
    const matchB = (afterPublishB.json.items || []).find((item) => item.type === 'NEW_PRODUCT' && String(item.body || '').includes(draftName));
    assert(matchA, 'customer A should receive new product notification after first publish');
    assert(matchB, 'customer B should receive new product notification after first publish');
    assert(!matchA.isRead, 'new product notification should start unread');
    assert(Number(afterPublishA.json?.unreadCount || 0) >= 1, 'customer A unread badge should include new product notification');
    assert(String(matchA.deeplink || '').includes(encodeURIComponent(String(draftCatalogId))), 'notification must deeplink to product details');

    const mark = await markRead(baseUrl, customerA.token, matchA.id);
    assert(mark.status === 200 && mark.json?.success, 'mark read failed for new product notification');
    const refreshed = (mark.json.items || []).find((item) => Number(item.id) === Number(matchA.id));
    assert(refreshed?.isRead, 'opening new product notification should mark it read');

    const editPublished = await adminUpdateProduct(baseUrl, adminToken, draftCatalogId, {
      ...productPayload(draftName, { publishStatus: 'active', price: 9999, stock: 3 }),
      description: 'Updated description only'
    });
    assert(editPublished.status === 200 && editPublished.json?.success, 'published product edit failed');
    await sleep(350);
    const afterEditA = await listCustomerNotifications(baseUrl, customerA.token);
    const newProductRows = (afterEditA.json.items || []).filter((item) => item.type === 'NEW_PRODUCT' && String(item.body || '').includes(draftName));
    assert(newProductRows.length === 1, 'editing a published product must not create another new-product notification');

    const duplicatePublish = await adminUpdateProduct(baseUrl, adminToken, draftCatalogId, productPayload(draftName, { publishStatus: 'active' }));
    assert(duplicatePublish.status === 200 && duplicatePublish.json?.success, 'duplicate publish update failed');
    await sleep(350);
    const afterDuplicateA = await listCustomerNotifications(baseUrl, customerA.token);
    const duplicateRows = (afterDuplicateA.json.items || []).filter((item) => item.type === 'NEW_PRODUCT' && String(item.entityId || '') === String(draftCatalogId));
    assert(duplicateRows.length === 1, 'repeat publish/save must not duplicate new-product notification');

    const liveName = `Live Product ${stamp}`;
    const liveCreate = await adminCreateProduct(baseUrl, adminToken, productPayload(liveName, { publishStatus: 'active' }));
    assert(liveCreate.status === 201 && liveCreate.json?.success, `live product create failed: ${liveCreate.raw}`);
    const liveCatalogId = liveCreate.json?.product?.catalogId || liveCreate.json?.product?.id;

    await sleep(450);
    const liveListA = await listCustomerNotifications(baseUrl, customerA.token);
    const liveListB = await listCustomerNotifications(baseUrl, customerB.token);
    assert((liveListA.json.items || []).some((item) => item.type === 'NEW_PRODUCT' && String(item.entityId || '') === String(liveCatalogId)), 'customer A should receive live-created product notification');
    assert((liveListB.json.items || []).some((item) => item.type === 'NEW_PRODUCT' && String(item.entityId || '') === String(liveCatalogId)), 'customer B should receive live-created product notification');
    assert(!(liveListB.json.items || []).some((item) => item.type === 'NEW_PRODUCT' && String(item.entityId || '') === String(liveCatalogId) && String(item.userId || '') === String(customerA.publicId)), 'customer notifications must not expose other users');

    const invalidCreate = await adminCreateProduct(baseUrl, adminToken, { price: 100 });
    assert(invalidCreate.status === 400, 'failed product creation must not succeed');
    await sleep(200);
    const afterInvalid = await listCustomerNotifications(baseUrl, customerA.token);
    const invalidRows = (afterInvalid.json.items || []).filter((item) => item.type === 'NEW_PRODUCT' && String(item.body || '').includes('undefined'));
    assert(invalidRows.length === 0, 'failed product creation must not create notifications');

    const customerSend = await request(baseUrl, 'POST', '/api/admin/customer-notifications', {
      token: customerA.token,
      body: {
        customerId: customerA.publicId,
        title: 'Blocked',
        message: 'Customers cannot send admin notifications.'
      }
    });
    assert(customerSend.status === 401 || customerSend.status === 403, 'customers must not access admin notification APIs');
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
    console.error('verify-new-product-notifications FAILED');
    failures.forEach((message) => console.error(` - ${message}`));
    process.exit(1);
  }

  console.log('verify-new-product-notifications OK');
}

main().catch((error) => {
  console.error('verify-new-product-notifications crashed:', error);
  process.exit(1);
});
