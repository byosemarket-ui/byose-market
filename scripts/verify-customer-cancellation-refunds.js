#!/usr/bin/env node
/**
 * Customer cancellation / return / refund center verification.
 * Uses a temporary SQLite database.
 *
 * Run: node scripts/verify-customer-cancellation-refunds.js
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
  const policyHtml = read('account/settings/policy.html');
  const settingsHtml = read('account/settings/settings.html');
  const clientJs = read('account/js/cancellation-refund.js');
  const routes = read('server/routes/orders.js');
  const controller = read('server/controllers/ordercontroller.js');
  const service = read('server/services/customercancellationrefundservice.js');
  const businessHours = read('server/utils/business-hours.js');

  assert(settingsHtml.includes('Cancellation'), 'settings hub must label Cancellation & Refunds');
  assert(policyHtml.includes('cancellation-refund.js'), 'policy page must load cancellation-refund.js');
  assert(policyHtml.includes('byosemarket@gmail.com'), 'policy must show official email');
  assert(policyHtml.includes('BYOSE MARKET LTD'), 'policy must show company name');
  assert(policyHtml.includes('48 business hours'), 'policy must include 48 business hours rule');
  assert(policyHtml.includes('refundOrdersList'), 'policy page must list real customer orders');
  assert(clientJs.includes('/api/orders/cancellation-refunds'), 'client must load refund center API');
  assert(clientJs.includes('/return-request'), 'client must submit return requests');
  assert(routes.includes('cancellation-refunds'), 'orders routes must expose refund center');
  assert(routes.includes('return-request'), 'orders routes must expose return-request');
  assert(controller.includes('getCancellationRefundCenter'), 'controller must implement refund center');
  assert(controller.includes('requestOrderReturn'), 'controller must implement return request');
  assert(service.includes('48'), 'eligibility service must enforce 48 business-hour windows');
  assert(businessHours.includes('Africa/Kigali'), 'business hours must use Rwanda timezone');
  assert(controller.includes('ownsOrder'), 'ownership checks must remain on customer updates');
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

async function runHttpScenarios() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byose-cancel-refund-'));
  const tmpDb = path.join(tmpDir, 'cancel-refund.sqlite');
  process.env.SQLITE_DB_PATH = tmpDb;
  process.env.DB_CLIENT = 'sqlite';
  process.env.JWT_SECRET = 'customer-cancel-refund-verify-secret';
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
    const {
      addBusinessHours,
      isBusinessDay,
      isWithinBusinessHoursWindow,
      isWithinCalendarHoursWindow
    } = require('../server/utils/business-hours');

    const friday = new Date('2026-03-06T10:00:00+02:00'); // Friday
    assert(isBusinessDay(friday), 'Friday is a business day');
    const sunday = new Date('2026-03-08T10:00:00+02:00');
    assert(!isBusinessDay(sunday), 'Sunday is not a business day');
    const plus48 = addBusinessHours(friday, 48, []);
    assert(plus48.getTime() > friday.getTime(), 'business hour add advances time');
    assert(isWithinBusinessHoursWindow(friday, 48, new Date(friday.getTime() + 2 * 3600000), []), 'inside 48bh window');
    assert(!isWithinBusinessHoursWindow(friday, 48, addBusinessHours(friday, 49, []), []), 'outside 48bh window');
    assert(isWithinCalendarHoursWindow(friday, 24, new Date(friday.getTime() + 23 * 3600000)), '24h calendar window open');
    assert(!isWithinCalendarHoursWindow(friday, 24, new Date(friday.getTime() + 25 * 3600000)), '24h calendar window closed');

    const stamp = Date.now();
    const emailA = `cancel.owner.${stamp}@example.com`;
    const emailB = `cancel.other.${stamp}@example.com`;
    const password = 'CancelPass1';
    const phoneA = '+250780000401';
    const phoneB = '+250780000402';

    const signupA = await request(baseUrl, 'POST', '/api/auth/signup', {
      body: { name: 'Cancel Owner', email: emailA, phone: phoneA, password }
    });
    assert(signupA.status === 200 && signupA.json?.success, `owner signup failed: ${signupA.raw}`);
    const tokenA = signupA.json.token;

    const signupB = await request(baseUrl, 'POST', '/api/auth/signup', {
      body: { name: 'Cancel Other', email: emailB, phone: phoneB, password }
    });
    assert(signupB.status === 200 && signupB.json?.success, `other signup failed: ${signupB.raw}`);
    const tokenB = signupB.json.token;

    const { getClient } = require('../server/database/sqlite/client');
    const db = getClient();
    const catalogId = 910000 + Math.floor(Math.random() * 1000);
    db.prepare(`
      INSERT INTO products (
        catalog_id, category_slug, name, title, price, stock, variants_json, metadata_json, status, visibility
      ) VALUES (?, 'general', ?, ?, 5000, 50, '{}', '{}', 'active', 'both')
    `).run(catalogId, 'Cancel Refund Item', 'Cancel Refund Item');

    const shipping = {
      fullName: 'Cancel Owner',
      phone: phoneA,
      provinceCity: 'Kigali',
      district: 'Gasabo',
      sector: 'Remera',
      cell: 'Rukiri',
      village: 'Gisimenti'
    };

    async function placeOrder(orderId, token) {
      return request(baseUrl, 'POST', '/api/orders', {
        token,
        body: {
          orderId,
          paymentMethod: 'cod',
          items: [{ productId: String(catalogId), quantity: 1, price: 5000, name: 'Cancel Refund Item' }],
          shippingAddress: shipping,
          customerName: shipping.fullName,
          customerPhone: phoneA
        }
      });
    }

    function patchOrder(orderId, patch) {
      const orderDataService = require('../server/services/orderdataservice');
      return orderDataService.findOrderByIdentifier(orderId).then(async (order) => {
        assert(order, `seed order missing: ${orderId}`);
        Object.assign(order, patch);
        await orderDataService.saveOrder(order);
        return order;
      });
    }

    const pendingId = `ORD-CANCEL-${stamp}`;
    const createPending = await placeOrder(pendingId, tokenA);
    assert(createPending.status === 200 || createPending.status === 201, `pending order create failed: ${createPending.raw}`);

    const deliveredId = `ORD-DELIVERED-${stamp}`;
    const createDelivered = await placeOrder(deliveredId, tokenA);
    assert(createDelivered.status === 200 || createDelivered.status === 201, `delivered seed create failed: ${createDelivered.raw}`);
    await patchOrder(deliveredId, {
      status: 'Delivered',
      orderStatus: 'delivered',
      paymentStatus: 'paid',
      paymentMethod: 'mtn',
      payment: { method: 'mtn', status: 'paid' },
      statusHistory: [
        { status: 'Confirmed', at: new Date(Date.now() - 3 * 3600000).toISOString() },
        { status: 'Delivered', at: new Date(Date.now() - 30 * 60000).toISOString() }
      ],
      updatedAt: new Date(Date.now() - 30 * 60000).toISOString()
    });

    const shippedId = `ORD-SHIPPED-${stamp}`;
    const createShipped = await placeOrder(shippedId, tokenA);
    assert(createShipped.status === 200 || createShipped.status === 201, `shipped seed create failed: ${createShipped.raw}`);
    await patchOrder(shippedId, {
      status: 'Shipping',
      orderStatus: 'shipping',
      statusHistory: [{ status: 'Shipping', at: new Date().toISOString() }],
      updatedAt: new Date().toISOString()
    });

    const center = await request(baseUrl, 'GET', '/api/orders/cancellation-refunds', { token: tokenA });
    assert(center.status === 200 && center.json?.success, `refund center failed: ${center.raw}`);
    assert(Array.isArray(center.json.orders) && center.json.orders.length >= 3, 'refund center must list owner orders');
    assert(center.json.policy?.contact?.email === 'byosemarket@gmail.com', 'policy contact email required');

    const pending = center.json.orders.find((order) => order.orderId === pendingId);
    assert(pending?.eligibility?.canCancel, 'fresh pending order should be cancellable');

    const shipped = center.json.orders.find((order) => order.orderId === shippedId);
    assert(shipped && !shipped.eligibility?.canCancel, 'shipped order must not be cancellable');

    const delivered = center.json.orders.find((order) => order.orderId === deliveredId);
    assert(delivered?.eligibility?.canRequestReturn, 'recently delivered order should allow return reasons');

    const otherCenter = await request(baseUrl, 'GET', '/api/orders/cancellation-refunds', { token: tokenB });
    assert(otherCenter.status === 200, 'other customer can load empty/own center');
    assert(
      !(otherCenter.json.orders || []).some((order) => [pendingId, deliveredId, shippedId].includes(order.orderId)),
      'other customer must not see owner orders'
    );

    const stealCancel = await request(baseUrl, 'PUT', `/api/orders/${pendingId}/status`, {
      token: tokenB,
      body: { status: 'Cancelled' }
    });
    assert(stealCancel.status === 403 || stealCancel.status === 404, 'cannot cancel another customer order');

    const stealReturn = await request(baseUrl, 'POST', `/api/orders/${deliveredId}/return-request`, {
      token: tokenB,
      body: { reasonCode: 'incorrect_product', customerNotes: 'steal' }
    });
    assert(stealReturn.status === 403 || stealReturn.status === 404, 'cannot request return on another customer order');

    const fakeId = await request(baseUrl, 'POST', '/api/orders/ORD-DOES-NOT-EXIST/return-request', {
      token: tokenA,
      body: { reasonCode: 'incorrect_product' }
    });
    assert(fakeId.status === 404, 'unknown order id must be rejected');

    const blockShippedCancel = await request(baseUrl, 'PUT', `/api/orders/${shippedId}/status`, {
      token: tokenA,
      body: { status: 'Cancelled' }
    });
    assert(blockShippedCancel.status === 409, 'dispatched order cancellation must be blocked');

    const cancelOk = await request(baseUrl, 'PUT', `/api/orders/${pendingId}/status`, {
      token: tokenA,
      body: { status: 'Cancelled', reason: 'Changed mind' }
    });
    assert(cancelOk.status === 200 && cancelOk.json?.success, `eligible cancel failed: ${cancelOk.raw}`);
    assert(
      String(cancelOk.json.order?.request?.statusLabel || '').toLowerCase().includes('cancel'),
      'cancelled status should display'
    );

    const returnOk = await request(baseUrl, 'POST', `/api/orders/${deliveredId}/return-request`, {
      token: tokenA,
      body: {
        reasonCode: 'incorrect_product',
        customerNotes: 'Received wrong color'
      }
    });
    assert(returnOk.status === 200 && returnOk.json?.success, `return request failed: ${returnOk.raw}`);
    assert(returnOk.json.order?.request?.statusLabel, 'request status must persist');
    assert(returnOk.json.order?.request?.status !== 'refunded', 'must not fake refunded status');

    const unsuitableBlocked = await request(baseUrl, 'POST', `/api/orders/${deliveredId}/return-request`, {
      token: tokenA,
      body: {
        reasonCode: 'unsuitable_product',
        attestUnused: true,
        attestOriginalPackaging: true
      }
    });
    assert(unsuitableBlocked.status === 409, 'duplicate return request must be blocked');

    const delayedId = `ORD-DELAY-${stamp}`;
    const createDelayed = await placeOrder(delayedId, tokenA);
    assert(createDelayed.status === 200 || createDelayed.status === 201, `delay seed create failed: ${createDelayed.raw}`);
    await patchOrder(delayedId, {
      status: 'Confirmed',
      orderStatus: 'confirmed',
      statusHistory: [{ status: 'Confirmed', at: addBusinessHours(new Date(), -50, []).toISOString() }],
      createdAt: addBusinessHours(new Date(), -60, []).toISOString(),
      updatedAt: addBusinessHours(new Date(), -50, []).toISOString()
    });

    const delayCenter = await request(baseUrl, 'GET', '/api/orders/cancellation-refunds', { token: tokenA });
    const delayRow = (delayCenter.json.orders || []).find((order) => order.orderId === delayedId);
    const delayAction = (delayRow?.eligibility?.actions || []).find((entry) => entry.reasonCode === 'delivery_delay');
    assert(delayAction?.eligible, 'undelivered order past 48 business hours after confirmation should allow delay refund request');

    const delayRequest = await request(baseUrl, 'POST', `/api/orders/${delayedId}/return-request`, {
      token: tokenA,
      body: { reasonCode: 'delivery_delay', customerNotes: 'No delivery and no notice' }
    });
    assert(delayRequest.status === 200, `delivery delay request failed: ${delayRequest.raw}`);

    const noAuth = await request(baseUrl, 'GET', '/api/orders/cancellation-refunds');
    assert(noAuth.status === 401, 'refund center requires authentication');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await closeDatabase().catch(() => {});
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_error) { /* ignore */ }
  }
}

async function main() {
  checkSourceGuards();
  await runHttpScenarios();

  if (failures.length) {
    console.error('FAIL verify-customer-cancellation-refunds');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('Customer cancellation/refund verification passed.');
}

main().catch((error) => {
  console.error('FAIL verify-customer-cancellation-refunds');
  console.error(error);
  process.exit(1);
});
