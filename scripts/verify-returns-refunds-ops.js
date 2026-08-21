#!/usr/bin/env node
/**
 * STEP 9 — Admin returns / refunds operational verification.
 * Temporary SQLite DB. No fake payment-provider refund success.
 *
 * Run: node scripts/verify-returns-refunds-ops.js
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
  const controller = read('server/controllers/ordercontroller.js');
  const ordersJs = read('admin/app/pages/orders.js');
  const data = read('admin/app/services/admin-data.service.js');
  const service = read('server/services/customercancellationrefundservice.js');

  assert(controller.includes("receive_return"), 'server must support receive_return');
  assert(controller.includes("inspect_return"), 'server must support inspect_return');
  assert(controller.includes("complete_refund"), 'server must support complete_refund');
  assert(controller.includes("refundStatus = 'processing'"), 'approve_refund must start processing, not fake completed');
  assert(controller.includes('requiresPhysicalReturn'), 'server must distinguish physical returns');
  assert(controller.includes('INVALID_REFUND_AMOUNT'), 'server must reject over-refund amounts');
  assert(controller.includes('stockRestored'), 'server must avoid double stock restore');
  assert(ordersJs.includes('receive-return'), 'admin UI must offer mark received');
  assert(ordersJs.includes('inspect-return'), 'admin UI must offer inspection');
  assert(ordersJs.includes('complete-refund'), 'admin UI must offer mark refund completed');
  assert(ordersJs.includes('Start Refund Processing'), 'admin UI must not pretend instant refund completion');
  assert(data.includes('returnReceivedAt'), 'admin normalize must expose receive timestamp');
  assert(data.includes('reasonCode'), 'admin normalize must expose reasonCode');
  assert(service.includes("key: 'inspected'"), 'customer status must include Inspected');
  assert(service.includes("returnStatus === 'requested'"), 'Under Review must prefer requested over early refund_required');
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

function runUnitWorkflow() {
  const {
    applyReturnAction,
    applyCancellationMetadata,
    resolveRefundablePaidAmount
  } = require('../server/controllers/ordercontroller').__testHooks;
  const { mapCustomerRequestStatus } = require('../server/services/customercancellationrefundservice');

  const restoreCalls = { count: 0 };
  const inventoryService = require('../server/services/inventory.service');
  const originalRestore = inventoryService.releaseOrRestoreForCancellation;
  inventoryService.releaseOrRestoreForCancellation = () => {
    restoreCalls.count += 1;
    return { skipped: false, state: 'RESTORED' };
  };

  try {
    // Physical return full path
    const physical = {
      orderId: 'UNIT-PHYS',
      status: 'Delivered',
      orderStatus: 'delivered',
      paymentStatus: 'paid',
      paymentMethod: 'mtn',
      totalAmount: 12000,
      total: 12000,
      payment: { status: 'paid', method: 'mtn' },
      statusHistory: []
    };

    applyReturnAction(physical, 'request_return', {
      actor: 'Customer',
      reasonCode: 'incorrect_product',
      reason: 'Wrong item',
      customerNotes: 'Wrong color'
    });
    assert(physical.payment.returnWorkflow.returnStatus === 'requested', 'physical request → requested');
    assert(physical.payment.returnWorkflow.requiresPhysicalReturn === true, 'incorrect_product requires physical return');
    assert(!physical.payment.returnWorkflow.refundStatus, 'physical request must not set refund required yet');
    assert(mapCustomerRequestStatus(physical).key === 'under_review', 'customer sees Under Review');

    let blocked = null;
    try {
      applyReturnAction(physical, 'approve_refund', { refundAmount: 12000 });
    } catch (error) {
      blocked = error;
    }
    assert(blocked?.code === 'REFUND_NOT_ELIGIBLE', 'cannot refund before inspect');

    applyReturnAction(physical, 'approve_return', { adminNotes: 'OK' });
    assert(physical.payment.returnWorkflow.returnStatus === 'approved', 'approve_return');
    assert(physical.status === 'Returned', 'order status Returned');
    assert(restoreCalls.count === 0, 'no stock restore on approve for physical return');
    assert(mapCustomerRequestStatus(physical).key === 'approved', 'customer sees Approved');

    applyReturnAction(physical, 'receive_return', { adminNotes: 'Received' });
    assert(physical.payment.returnWorkflow.returnStatus === 'received', 'receive_return');
    assert(mapCustomerRequestStatus(physical).key === 'return_received', 'customer sees Return Received');

    applyReturnAction(physical, 'inspect_return', {
      inspectResult: 'pass',
      restockEligible: true,
      adminNotes: 'Good condition'
    });
    assert(physical.payment.returnWorkflow.returnStatus === 'inspected', 'inspect_return');
    assert(physical.payment.returnWorkflow.refundStatus === 'required', 'inspect pass → refund required');
    assert(physical.payment.returnWorkflow.stockRestored === true, 'stock restored after eligible inspect');
    assert(restoreCalls.count === 1, 'stock restored exactly once');
    assert(mapCustomerRequestStatus(physical).key === 'inspected', 'customer sees Inspected');

    applyReturnAction(physical, 'inspect_return', { inspectResult: 'pass', restockEligible: true });
    assert(restoreCalls.count === 1, 'duplicate inspect must not restore stock twice');

    try {
      applyReturnAction(physical, 'approve_refund', { refundAmount: 999999 });
      assert(false, 'over-refund must throw');
    } catch (error) {
      assert(error.code === 'INVALID_REFUND_AMOUNT', 'over-refund blocked');
    }

    applyReturnAction(physical, 'approve_refund', { refundAmount: 12000, refundMethod: 'mtn' });
    assert(physical.payment.returnWorkflow.refundStatus === 'processing', 'approve_refund → processing only');
    assert(physical.paymentStatus !== 'refunded', 'must not mark payment refunded before completion');
    assert(mapCustomerRequestStatus(physical).key === 'refund_processing', 'customer sees Refund Processing');

    applyReturnAction(physical, 'approve_refund', { refundAmount: 12000 });
    assert(physical.payment.returnWorkflow.refundStatus === 'processing', 'duplicate start refund is idempotent');

    applyReturnAction(physical, 'complete_refund', { adminNotes: 'Money returned' });
    assert(physical.payment.returnWorkflow.refundStatus === 'completed', 'complete_refund');
    assert(physical.paymentStatus === 'refunded', 'payment refunded after confirm');
    assert(physical.status === 'Refunded', 'order Refunded');
    assert(mapCustomerRequestStatus(physical).key === 'refunded', 'customer sees Refunded');

    try {
      applyReturnAction(physical, 'complete_refund', {});
      // idempotent no-throw
    } catch (error) {
      failures.push(`complete_refund should be idempotent: ${error.message}`);
    }
    try {
      applyReturnAction(physical, 'approve_refund', { refundAmount: 1 });
      assert(false, 'duplicate completed refund must throw');
    } catch (error) {
      assert(error.code === 'DUPLICATE_REFUND', 'duplicate refund blocked');
    }

    // Damaged inspect — no restock, refund rejected
    restoreCalls.count = 0;
    const damaged = {
      orderId: 'UNIT-DMG',
      status: 'Delivered',
      paymentStatus: 'paid',
      totalAmount: 5000,
      payment: { status: 'paid' },
      statusHistory: []
    };
    applyReturnAction(damaged, 'request_return', { reasonCode: 'unsuitable_product', reason: 'Unsuitable' });
    applyReturnAction(damaged, 'approve_return', {});
    applyReturnAction(damaged, 'receive_return', {});
    applyReturnAction(damaged, 'inspect_return', {
      inspectResult: 'fail',
      restockEligible: false,
      adminNotes: 'Damaged by customer'
    });
    assert(damaged.payment.returnWorkflow.refundStatus === 'rejected', 'failed inspect rejects refund');
    assert(restoreCalls.count === 0, 'failed inspect must not restock');
    assert(mapCustomerRequestStatus(damaged).key === 'rejected', 'customer sees Rejected');

    // Paid cancel — no physical return, unpaid amount path
    const paidCancel = {
      orderId: 'UNIT-CANCEL-PAID',
      status: 'Processing',
      paymentStatus: 'paid',
      totalAmount: 8000,
      payment: { status: 'paid' },
      statusHistory: []
    };
    applyCancellationMetadata(paidCancel, { actor: 'Customer', reason: 'Changed mind' });
    assert(paidCancel.payment.returnWorkflow.requiresPhysicalReturn === false, 'cancel is non-physical');
    assert(paidCancel.paymentStatus === 'refund_required', 'paid cancel prepares refund');
    assert(resolveRefundablePaidAmount(paidCancel) === 8000, 'paid amount for refund');
    assert(mapCustomerRequestStatus(paidCancel).key === 'under_review', 'paid cancel under review while requested');

    applyReturnAction(paidCancel, 'approve_refund', { refundAmount: 8000 });
    assert(paidCancel.payment.returnWorkflow.refundStatus === 'processing', 'cancel refund starts processing');
    applyReturnAction(paidCancel, 'complete_refund', {});
    assert(paidCancel.paymentStatus === 'refunded', 'cancel refund completed');

    const unpaidCod = {
      orderId: 'UNIT-COD',
      status: 'Processing',
      paymentStatus: 'awaiting_delivery_payment',
      totalAmount: 7000,
      payment: { status: 'awaiting_delivery_payment', method: 'cod' },
      statusHistory: []
    };
    applyCancellationMetadata(unpaidCod, { actor: 'Customer', reason: 'Cancel COD' });
    assert(unpaidCod.paymentStatus !== 'refund_required', 'unpaid COD must not require refund');
    assert(resolveRefundablePaidAmount(unpaidCod) === 0, 'unpaid COD refundable amount is 0');
    unpaidCod.payment = unpaidCod.payment || {};
    unpaidCod.payment.returnWorkflow = {
      returnStatus: 'requested',
      refundStatus: 'required',
      requiresPhysicalReturn: false,
      reasonCode: 'cancel'
    };
    try {
      applyReturnAction(unpaidCod, 'approve_refund', { refundAmount: 7000 });
      assert(false, 'unpaid refund must fail');
    } catch (error) {
      assert(error.code === 'REFUND_NOT_ELIGIBLE', 'unpaid COD refund blocked');
    }
  } finally {
    inventoryService.releaseOrRestoreForCancellation = originalRestore;
  }
}

async function runHttpScenarios(tmpDir) {
  // SQLITE_DB_PATH must already be set before any require of server/config/env.js
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
    const email = `returns.ops.${stamp}@example.com`;
    const password = 'ReturnsOps1';
    const phone = '+250780000501';

    const signup = await request(baseUrl, 'POST', '/api/auth/signup', {
      body: { name: 'Returns Ops', email, phone, password }
    });
    assert(signup.status === 200 && signup.json?.success, `signup failed: ${signup.raw}`);
    const customerToken = signup.json.token;

    const adminEmail = String(process.env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
    const adminToken = generateToken({
      id: `ADMIN_${Buffer.from(adminEmail).toString('hex').slice(0, 16)}`,
      email: adminEmail,
      role: 'admin',
      sid: 'sess_returns_ops'
    });

    const { getClient } = require('../server/database/sqlite/client');
    const db = getClient();
    const catalogId = 920000 + Math.floor(Math.random() * 1000);
    db.prepare(`
      INSERT INTO products (
        catalog_id, category_slug, name, title, price, stock, variants_json, metadata_json, status, visibility
      ) VALUES (?, 'general', ?, ?, 9000, 40, ?, '{}', 'active', 'both')
    `).run(
      catalogId,
      'Returns Ops Item',
      'Returns Ops Item',
      JSON.stringify({
        colors: [
          {
            name: 'Grey',
            sizes: [
              { size: '40', stock: 10 },
              { size: '41', stock: 10 }
            ]
          }
        ]
      })
    );

    const shipping = {
      fullName: 'Returns Ops',
      phone,
      provinceCity: 'Kigali',
      district: 'Gasabo',
      sector: 'Remera',
      cell: 'Rukiri',
      village: 'Gisimenti'
    };

    const orderId = `ORD-RETOPS-${stamp}`;
    const create = await request(baseUrl, 'POST', '/api/orders', {
      token: customerToken,
      body: {
        orderId,
        paymentMethod: 'mtn',
        items: [{
          productId: String(catalogId),
          quantity: 1,
          price: 9000,
          name: 'Returns Ops Item',
          color: 'Grey',
          size: '40',
          sku: 'GREY-40'
        }],
        shippingAddress: shipping,
        customerName: shipping.fullName,
        customerPhone: phone
      }
    });
    assert(create.status === 200 || create.status === 201, `order create failed: ${create.raw}`);

    const orderDataService = require('../server/services/orderdataservice');
    const seeded = await orderDataService.findOrderByIdentifier(orderId);
    Object.assign(seeded, {
      status: 'Delivered',
      orderStatus: 'delivered',
      paymentStatus: 'paid',
      paymentMethod: 'mtn',
      payment: { ...(seeded.payment || {}), method: 'mtn', status: 'paid' },
      statusHistory: [
        { status: 'Confirmed', at: new Date(Date.now() - 4 * 3600000).toISOString() },
        { status: 'Delivered', at: new Date(Date.now() - 20 * 60000).toISOString() }
      ],
      updatedAt: new Date(Date.now() - 20 * 60000).toISOString()
    });
    await orderDataService.saveOrder(seeded);

    const returnReq = await request(baseUrl, 'POST', `/api/orders/${orderId}/return-request`, {
      token: customerToken,
      body: { reasonCode: 'incorrect_product', customerNotes: 'Wrong size delivered' }
    });
    assert(returnReq.status === 200 && returnReq.json?.success, `return request failed: ${returnReq.raw}`);
    assert(returnReq.json.order?.request?.status === 'under_review', 'customer status under_review after request');

    const unauthAdmin = await request(baseUrl, 'PUT', `/api/admin/orders/${orderId}/status`, {
      body: { returnAction: 'approve_return' }
    });
    assert([401, 403].includes(unauthAdmin.status), 'admin return action requires auth');

    const approve = await request(baseUrl, 'PUT', `/api/admin/orders/${orderId}/status`, {
      token: adminToken,
      body: { returnAction: 'approve_return', adminNotes: 'Approved for return' }
    });
    assert(approve.status === 200 && approve.json?.success, `approve_return failed: ${approve.raw}`);

    const earlyRefund = await request(baseUrl, 'PUT', `/api/admin/orders/${orderId}/status`, {
      token: adminToken,
      body: { returnAction: 'approve_refund', refundAmount: 9000 }
    });
    assert(earlyRefund.status === 409, 'refund before inspect must be blocked');

    const receive = await request(baseUrl, 'PUT', `/api/admin/orders/${orderId}/status`, {
      token: adminToken,
      body: { returnAction: 'receive_return', adminNotes: 'Parcel received' }
    });
    assert(receive.status === 200 && receive.json?.success, `receive_return failed: ${receive.raw}`);

    const inspect = await request(baseUrl, 'PUT', `/api/admin/orders/${orderId}/status`, {
      token: adminToken,
      body: {
        returnAction: 'inspect_return',
        inspectResult: 'pass',
        restockEligible: true,
        adminNotes: 'Unused / original packaging'
      }
    });
    assert(inspect.status === 200 && inspect.json?.success, `inspect_return failed: ${inspect.raw}`);

    const center = await request(baseUrl, 'GET', '/api/orders/cancellation-refunds', { token: customerToken });
    const listed = (center.json?.orders || []).find((row) => row.orderId === orderId);
    assert(listed?.request?.status === 'inspected', `customer must see inspected, got ${listed?.request?.status}`);

    const startRefund = await request(baseUrl, 'PUT', `/api/admin/orders/${orderId}/status`, {
      token: adminToken,
      body: { returnAction: 'approve_refund', refundAmount: 9000, refundMethod: 'mtn' }
    });
    assert(startRefund.status === 200 && startRefund.json?.success, `start refund failed: ${startRefund.raw}`);
    assert(
      String(startRefund.json.order?.payment?.returnWorkflow?.refundStatus || '').toLowerCase() === 'processing'
        || String(startRefund.json.order?.returnWorkflow?.refundStatus || '').toLowerCase() === 'processing'
        || String(startRefund.json.order?.paymentStatus || '').toLowerCase() !== 'refunded',
      'must stay processing, not completed'
    );

    const dupStart = await request(baseUrl, 'PUT', `/api/admin/orders/${orderId}/status`, {
      token: adminToken,
      body: { returnAction: 'approve_refund', refundAmount: 9000 }
    });
    assert(dupStart.status === 200 || dupStart.status === 409, 'duplicate start refund must not create second refund');

    const complete = await request(baseUrl, 'PUT', `/api/admin/orders/${orderId}/status`, {
      token: adminToken,
      body: { returnAction: 'complete_refund', adminNotes: 'Refunded to MTN' }
    });
    assert(complete.status === 200 && complete.json?.success, `complete_refund failed: ${complete.raw}`);

    const centerDone = await request(baseUrl, 'GET', '/api/orders/cancellation-refunds', { token: customerToken });
    const doneRow = (centerDone.json?.orders || []).find((row) => row.orderId === orderId);
    assert(doneRow?.request?.status === 'refunded', `customer must see refunded, got ${doneRow?.request?.status}`);

    const dupComplete = await request(baseUrl, 'PUT', `/api/admin/orders/${orderId}/status`, {
      token: adminToken,
      body: { returnAction: 'complete_refund' }
    });
    assert(dupComplete.status === 200 || dupComplete.status === 409, 'duplicate complete must be safe');

    // Variant isolation: Grey/41 stock unchanged after Grey/40 restock path
    const product = db.prepare('SELECT variants_json, stock FROM products WHERE catalog_id = ?').get(catalogId);
    const variants = JSON.parse(product.variants_json || '{}');
    const grey = (variants.colors || []).find((color) => String(color.name).toLowerCase() === 'grey');
    const size41 = (grey?.sizes || []).find((size) => String(size.size) === '41');
    assert(size41 && Number(size41.stock) === 10, 'Grey/41 stock must remain isolated at 10');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await closeDatabase().catch(() => {});
  }
}

async function main() {
  checkSourceGuards();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byose-returns-ops-'));
  const tmpDb = path.join(tmpDir, 'returns-ops.sqlite');
  // Must set before requiring server modules — env.js caches SQLITE_DB_PATH at load time.
  process.env.SQLITE_DB_PATH = tmpDb;
  process.env.DB_CLIENT = 'sqlite';
  process.env.JWT_SECRET = 'verify-returns-ops-secret';
  process.env.NODE_ENV = 'test';
  process.env.BYOSE_VERIFY = '1';

  try {
    runUnitWorkflow();
    await runHttpScenarios(tmpDir);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_error) { /* ignore */ }
  }

  // Keep existing static admin returns verify green expectations aligned
  const staticOrders = read('admin/app/pages/orders.js');
  assert(staticOrders.includes('Approve Return'), 'Approve Return still present');
  assert(staticOrders.includes('Reject Return'), 'Reject Return still present');
  assert(staticOrders.includes('Reject Refund'), 'Reject Refund still present');

  if (failures.length) {
    console.error('FAIL — Returns & Refunds ops verification\n');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('PASS — Returns & Refunds ops verification');
  console.log(' - Physical return: request → approve → receive → inspect → processing → completed');
  console.log(' - Idempotent refund/stock guards + unpaid COD block');
  console.log(' - Admin auth + customer status sync + variant isolation');
}

main().catch((error) => {
  console.error('FAIL — Returns & Refunds ops verification');
  console.error(error);
  process.exit(1);
});
