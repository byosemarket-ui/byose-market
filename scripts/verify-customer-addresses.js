#!/usr/bin/env node
/**
 * Customer shipping address management verification.
 * Uses a temporary SQLite database. Does not create live orders or payments.
 *
 * Run: node scripts/verify-customer-addresses.js
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
  const migration = read('server/database/sqlite/migrations/032_customer_addresses.sql');
  const service = read('server/services/customeraddress.service.js');
  const controller = read('server/controllers/customeraddresscontroller.js');
  const routes = read('server/routes/customeraddresses.js');
  const apiIndex = read('server/api/index.js');
  const addressPage = read('account/settings/address.html');
  const addressJs = read('account/js/address.js');
  const client = read('services/customer-addresses.js');
  const shippingHtml = read('orders/shipping.html');
  const shippingJs = read('orders/shipping.js');
  const stateJs = read('orders/core/state.js');
  const orderController = read('server/controllers/ordercontroller.js');

  assert(migration.includes('CREATE TABLE IF NOT EXISTS customer_addresses'), 'migration creates customer_addresses');
  assert(service.includes('findOwned'), 'address service enforces ownership lookups');
  assert(service.includes('setDefaultForUser'), 'address service can set a default address');
  assert(routes.includes('authMiddleware'), 'address routes require customer auth');
  assert(apiIndex.includes("'/addresses'"), 'API mounts /api/addresses');
  assert(controller.includes('listForUser'), 'controller lists owned addresses');
  assert(addressPage.includes('provinceCity'), 'account address form matches checkout fields');
  assert(addressPage.includes('id="cell"'), 'account address form includes cell');
  assert(addressPage.includes('id="village"'), 'account address form includes village');
  assert(!addressPage.includes('addr_1'), 'account page no longer shows static placeholder cards');
  assert(addressJs.includes('ByoseCustomerAddresses'), 'account page uses the address API client');
  assert(addressJs.includes('setDefault'), 'account page can set default');
  assert(client.includes("'/addresses'"), 'frontend address client calls /api/addresses');
  assert(shippingHtml.includes('savedAddressPanel'), 'checkout shows saved address picker');
  assert(shippingHtml.includes('customer-addresses.js'), 'checkout loads address client');
  assert(shippingHtml.includes('Add New Address'), 'checkout can add a new address');
  assert(shippingHtml.includes('saveToAccount'), 'checkout can optionally save a new address');
  assert(shippingHtml.includes('updateSavedAddress'), 'checkout can optionally update a saved address');
  assert(shippingJs.includes('hydrateSavedAddresses'), 'checkout hydrates saved addresses');
  assert(shippingJs.includes('Select Address'), 'checkout offers Select Address');
  assert(shippingJs.includes('Edit Address'), 'checkout offers Edit Address');
  assert(shippingJs.includes('Set as Default'), 'checkout offers Set as Default');
  assert(shippingJs.includes('maybeSyncAddressBook'), 'checkout syncs address book only when opted in');
  assert(stateJs.includes('hydrateSavedAddresses'), 'checkout state exposes hydrateSavedAddresses');
  assert(stateJs.includes('selectSavedAddress'), 'checkout state can select a saved address');
  assert(!stateJs.includes('persistUserAddress(state.shipping'), 'continueToReview must not overwrite saved addresses');
  assert(orderController.includes('ADDRESS_FORBIDDEN'), 'orders reject another customer saved address');
  assert(orderController.includes('findOwned'), 'orders verify saved address ownership');
  assert(orderController.includes('toClientAddress(ownedAddress)'), 'orders freeze a snapshot from the owned address');
  assert(read('orders/utils.js').includes("mode === 'none'"), 'address persist supports order-only mode');
  assert(read('orders/ui/layout.js').includes('Saved address selected'), 'review shows selected saved address');
}

function request(baseUrl, method, pathname, { body, token } = {}) {
  const payload = body == null ? null : JSON.stringify(body);
  const url = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = raw ? JSON.parse(raw) : null;
        } catch (_error) {
          json = null;
        }
        resolve({ status: res.statusCode, json, raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runApiChecks() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byose-address-'));
  const dbPath = path.join(tempDir, 'addresses.sqlite');
  process.env.NODE_ENV = 'test';
  process.env.DB_CLIENT = 'sqlite';
  process.env.SQLITE_DB_PATH = dbPath;
  process.env.JWT_SECRET = 'address-test-secret-key';

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
    const password = 'AddressPass1';
    const emailA = `address.owner.${Date.now()}@example.com`;
    const emailB = `address.other.${Date.now()}@example.com`;
    const phoneA = '+250780000101';
    const phoneB = '+250780000102';

    const signupA = await request(baseUrl, 'POST', '/api/auth/signup', {
      body: { name: 'Address Owner', email: emailA, phone: phoneA, password }
    });
    assert(signupA.status === 200 && signupA.json?.success, `owner signup failed: ${signupA.raw}`);
    const tokenA = signupA.json?.token || '';
    assert(Boolean(tokenA), 'owner receives an access token');

    const signupB = await request(baseUrl, 'POST', '/api/auth/signup', {
      body: { name: 'Other Customer', email: emailB, phone: phoneB, password }
    });
    assert(signupB.status === 200 && signupB.json?.success, `other customer signup failed: ${signupB.raw}`);
    const tokenB = signupB.json?.token || '';
    assert(Boolean(tokenB), 'other customer receives an access token');

    const createA = await request(baseUrl, 'POST', '/api/addresses', {
      token: tokenA,
      body: {
        fullName: 'Address Owner',
        phone: phoneA,
        provinceCity: 'Kigali',
        district: 'Gasabo',
        sector: 'Kacyiru',
        cell: 'Kamatamu',
        village: 'Rugando',
        note: 'Blue gate',
        isDefault: true
      }
    });
    assert(createA.status === 201, `create address returns 201 (got ${createA.status}: ${createA.raw})`);
    assert(createA.json?.address?.isDefault === true, 'first address becomes default');
    const addressId = createA.json?.address?.id;
    assert(Boolean(addressId), 'created address has an id');

    const createSecond = await request(baseUrl, 'POST', '/api/addresses', {
      token: tokenA,
      body: {
        fullName: 'Address Owner Work',
        phone: phoneA,
        provinceCity: 'Kigali',
        district: 'Nyarugenge',
        sector: 'Nyamirambo',
        cell: 'Rwezamenyo',
        village: 'Biryogo',
        isDefault: false
      }
    });
    assert(createSecond.status === 201, `second address can be created (got ${createSecond.status}: ${createSecond.raw})`);
    const secondId = createSecond.json?.address?.id;

    const listA = await request(baseUrl, 'GET', '/api/addresses', { token: tokenA });
    assert(listA.status === 200, 'owner can list addresses');
    assert(Array.isArray(listA.json?.addresses) && listA.json.addresses.length === 2, 'owner sees two addresses');

    const listB = await request(baseUrl, 'GET', '/api/addresses', { token: tokenB });
    assert(listB.status === 200, 'other customer can list their own addresses');
    assert(Array.isArray(listB.json?.addresses) && listB.json.addresses.length === 0, 'other customer does not see owner addresses');

    const steal = await request(baseUrl, 'PUT', `/api/addresses/${addressId}`, {
      token: tokenB,
      body: {
        fullName: 'Hacker',
        phone: phoneB,
        provinceCity: 'Kigali',
        district: 'Gasabo',
        sector: 'Remera',
        cell: 'Rukiri',
        village: 'Gishushu'
      }
    });
    assert(steal.status === 404, 'other customer cannot edit owner address');

    const stealDelete = await request(baseUrl, 'DELETE', `/api/addresses/${addressId}`, { token: tokenB });
    assert(stealDelete.status === 404, 'other customer cannot delete owner address');

    const setDefault = await request(baseUrl, 'POST', `/api/addresses/${secondId}/default`, {
      token: tokenA,
      body: {}
    });
    assert(setDefault.status === 200, `owner can set default address (got ${setDefault.status}: ${setDefault.raw})`);
    assert(setDefault.json?.address?.isDefault === true, 'selected address becomes default');

    const listAfterDefault = await request(baseUrl, 'GET', '/api/addresses', { token: tokenA });
    const defaults = (listAfterDefault.json?.addresses || []).filter((entry) => entry.isDefault);
    assert(defaults.length === 1 && defaults[0].id === secondId, 'exactly one default address remains');

    const guestCreate = await request(baseUrl, 'POST', '/api/addresses', {
      body: {
        fullName: 'Guest',
        phone: '+250780000199',
        provinceCity: 'Kigali',
        district: 'Gasabo',
        sector: 'Kacyiru',
        cell: 'Kamatamu',
        village: 'Rugando'
      }
    });
    assert(guestCreate.status === 401, 'guests cannot save permanent addresses');

    const updateA = await request(baseUrl, 'PUT', `/api/addresses/${secondId}`, {
      token: tokenA,
      body: {
        fullName: 'Address Owner Work Updated',
        phone: phoneA,
        provinceCity: 'Kigali',
        district: 'Nyarugenge',
        sector: 'Nyamirambo',
        cell: 'Rwezamenyo',
        village: 'Biryogo',
        note: 'Updated landmark'
      }
    });
    assert(updateA.status === 200, 'owner can update address');
    assert(updateA.json?.address?.note === 'Updated landmark', 'address update persists note');

    const removeSecond = await request(baseUrl, 'DELETE', `/api/addresses/${secondId}`, { token: tokenA });
    assert(removeSecond.status === 200, 'owner can delete address');
    const listFinal = await request(baseUrl, 'GET', '/api/addresses', { token: tokenA });
    assert(listFinal.json?.addresses?.length === 1, 'one address remains after delete');
    assert(listFinal.json.addresses[0].isDefault === true, 'remaining address becomes default');

    await runCheckoutOrderSnapshotChecks({
      baseUrl,
      request,
      assert,
      tokenA,
      tokenB,
      phoneA,
      addressId: listFinal.json.addresses[0].id
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await closeDatabase().catch(() => {});
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_error) {
      // ignore cleanup errors on Windows locks
    }
  }
}

async function runCheckoutOrderSnapshotChecks({
  baseUrl,
  request,
  assert,
  tokenA,
  tokenB,
  phoneA,
  addressId
}) {
  const { getClient } = require('../server/database/sqlite/client');
  const db = getClient();
  const catalogId = 900001 + Math.floor(Math.random() * 1000);
  db.prepare(`
    INSERT INTO products (
      catalog_id, category_slug, name, title, price, stock, variants_json, metadata_json, status, visibility
    ) VALUES (?, 'general', ?, ?, 1500, 20, '{}', '{}', 'active', 'both')
  `).run(catalogId, 'Address Checkout Item', 'Address Checkout Item');

  const shipping = {
    fullName: 'Address Owner',
    phone: phoneA,
    provinceCity: 'Kigali',
    district: 'Gasabo',
    sector: 'Kacyiru',
    cell: 'Kamatamu',
    village: 'OriginalVillage',
    note: 'Order snapshot landmark',
    savedAddressId: addressId
  };

  const orderId = `ORD-ADDR-${Date.now()}`;
  const createOrder = await request(baseUrl, 'POST', '/api/orders', {
    token: tokenA,
    body: {
      orderId,
      paymentMethod: 'cod',
      items: [{ productId: String(catalogId), quantity: 1, price: 1500, name: 'Address Checkout Item' }],
      shippingAddress: shipping,
      customerName: shipping.fullName,
      customerPhone: phoneA
    }
  });
  assert(createOrder.status === 200 || createOrder.status === 201, `signed-in order create failed: ${createOrder.raw}`);
  const created = createOrder.json?.order || createOrder.json;
  const createdShipping = created?.shippingAddress || {};
  assert(createdShipping.village === 'OriginalVillage', 'order stores the delivery village snapshot');
  assert(createdShipping.savedAddressId === addressId, 'order keeps the selected saved address id');

  const stealOrder = await request(baseUrl, 'POST', '/api/orders', {
    token: tokenB,
    body: {
      orderId: `ORD-STEAL-${Date.now()}`,
      paymentMethod: 'cod',
      items: [{ productId: String(catalogId), quantity: 1, price: 1500, name: 'Address Checkout Item' }],
      shippingAddress: { ...shipping, savedAddressId: addressId },
      customerName: 'Other Customer',
      customerPhone: '+250780000102'
    }
  });
  assert(stealOrder.status === 403, 'other customer cannot place an order with a stolen saved address id');

  const updateSaved = await request(baseUrl, 'PUT', `/api/addresses/${addressId}`, {
    token: tokenA,
    body: {
      fullName: 'Address Owner',
      phone: phoneA,
      provinceCity: 'Kigali',
      district: 'Gasabo',
      sector: 'Kacyiru',
      cell: 'Kamatamu',
      village: 'ChangedLater',
      note: 'Changed after order'
    }
  });
  assert(updateSaved.status === 200, 'saved address can be edited after order creation');

  const confirmation = await request(baseUrl, 'GET', `/api/orders/confirmation/${encodeURIComponent(orderId)}`);
  const confirmedShipping = confirmation.json?.confirmation?.shippingAddress || {};
  assert(
    confirmation.status === 200 && confirmedShipping.village === 'OriginalVillage',
    'existing order keeps original address after saved address edit'
  );

  const guestOrderId = `ORD-GUEST-${Date.now()}`;
  const guestOrder = await request(baseUrl, 'POST', '/api/orders', {
    body: {
      orderId: guestOrderId,
      paymentMethod: 'cod',
      items: [{ productId: String(catalogId), quantity: 1, price: 1500, name: 'Address Checkout Item' }],
      shippingAddress: {
        fullName: 'Guest Buyer',
        phone: '+250780000199',
        provinceCity: 'Kigali',
        district: 'Gasabo',
        sector: 'Kacyiru',
        cell: 'Kamatamu',
        village: 'GuestVillage',
        note: 'Guest only'
      },
      customerName: 'Guest Buyer',
      customerPhone: '+250780000199'
    }
  });
  assert(guestOrder.status === 200 || guestOrder.status === 201, `guest checkout failed: ${guestOrder.raw}`);
  const guestShipping = guestOrder.json?.order?.shippingAddress || {};
  assert(!guestShipping.savedAddressId, 'guest order has no saved address id');

  const guestList = await request(baseUrl, 'GET', '/api/addresses', { token: tokenA });
  assert(
    Array.isArray(guestList.json?.addresses)
      && guestList.json.addresses.every((entry) => entry.village !== 'GuestVillage'),
    'guest checkout does not create a customer saved address'
  );
}

async function main() {
  checkSourceGuards();
  await runApiChecks();

  if (failures.length) {
    console.error('Customer address verification failed:');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('Customer address verification passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
