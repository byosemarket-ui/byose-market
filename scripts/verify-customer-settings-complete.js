#!/usr/bin/env node
/**
 * STEP 10 — Settings completion verification (guide, about, danger zone, logout wiring).
 * Uses a temporary SQLite database.
 *
 * Run: node scripts/verify-customer-settings-complete.js
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
  const settingsHtml = read('account/settings/settings.html');
  const guideHtml = read('account/settings/guide.html');
  const aboutHtml = read('account/settings/about.html');
  const deleteHtml = read('account/settings/delete-account.html');
  const guideJs = read('account/js/guide.js');
  const deleteJs = read('account/js/delete-account.js');
  const authRoutes = read('server/routes/auth.js');
  const authController = read('server/controllers/authcontroller.js');
  const authService = read('services/authservice.js');
  const logoutJs = read('logout/logout.js');

  assert(settingsHtml.includes('guide.html'), 'settings hub must link User Guide');
  assert(settingsHtml.includes('about.html'), 'settings hub must link About Us');
  assert(settingsHtml.includes('delete-account.html'), 'settings hub must link Danger Zone');
  assert(settingsHtml.includes('../../logout/logout.html'), 'settings hub must link Logout');
  assert(!settingsHtml.includes('support@byosemarket.com'), 'settings hub must not invent support@ email');

  assert(guideHtml.includes('guide.js'), 'guide must load interactive JS');
  assert(guideHtml.includes('storefront-settings.js'), 'guide must use storefront contacts');
  assert(guideHtml.includes('../orders/all.html'), 'guide must link real orders page');
  assert(guideHtml.includes('policy.html'), 'guide must link cancellation/refunds');
  assert(guideHtml.includes('address.html'), 'guide must link address management');
  assert(guideHtml.includes('reset-password.html'), 'guide must link password page');
  assert(!guideHtml.includes('#chat'), 'guide must not keep dead chat link');
  assert(!guideHtml.includes('Track Package'), 'guide must not document nonexistent Track Package button');
  assert(guideJs.includes('faq-question'), 'guide JS must toggle FAQ accordion');

  assert(aboutHtml.includes('storefront-settings.js'), 'about must bind real company settings');
  assert(aboutHtml.includes('data-store-setting="companyName"'), 'about must show company name from settings');
  assert(aboutHtml.includes('byosemarket@gmail.com'), 'about defaults must match official email');
  assert(!aboutHtml.includes('href="#"'), 'about must not keep placeholder social hrefs');
  assert(!aboutHtml.includes('+250 788 000 000'), 'about must not keep placeholder phone');

  assert(deleteHtml.includes('delete-account.js'), 'danger zone must load delete script');
  assert(deleteHtml.includes('Type DELETE'), 'danger zone must require explicit DELETE confirmation');
  assert(deleteJs.includes('deleteAccount'), 'danger zone must call authService.deleteAccount');
  assert(authRoutes.includes("router.delete('/me'"), 'auth routes must expose DELETE /api/auth/me');
  assert(authController.includes('exports.deleteAccount'), 'auth controller must implement deleteAccount');
  assert(authController.includes("confirmation") && authController.includes("'DELETE'"), 'delete must require DELETE confirmation');
  assert(authController.includes('revokeAllForUser'), 'delete must revoke customer sessions');
  assert(authService.includes('async function deleteAccount'), 'authService must expose deleteAccount');

  assert(logoutJs.includes('authService.logout'), 'logout page must use authService.logout');
  assert(logoutJs.includes('clearLocalAuth'), 'logout must clear local auth state');
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byose-settings-complete-'));
  const tmpDb = path.join(tmpDir, 'settings-complete.sqlite');
  process.env.SQLITE_DB_PATH = tmpDb;
  process.env.DB_CLIENT = 'sqlite';
  process.env.JWT_SECRET = 'verify-settings-complete-secret';
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
    const email = `settings.complete.${stamp}@example.com`;
    const otherEmail = `settings.other.${stamp}@example.com`;
    const password = 'SettingsPass1';
    const phone = '+250780000601';
    const otherPhone = '+250780000602';

    const signup = await request(baseUrl, 'POST', '/api/auth/signup', {
      body: { name: 'Settings Complete', email, phone, password }
    });
    assert(signup.status === 200 && signup.json?.success, `signup failed: ${signup.raw}`);
    const token = signup.json.token;
    const userId = signup.json.user?.id || signup.json.user?.publicId;

    const otherSignup = await request(baseUrl, 'POST', '/api/auth/signup', {
      body: { name: 'Settings Other', email: otherEmail, phone: otherPhone, password }
    });
    assert(otherSignup.status === 200 && otherSignup.json?.success, `other signup failed: ${otherSignup.raw}`);
    const otherToken = otherSignup.json.token;

    const me = await request(baseUrl, 'GET', '/api/auth/me', { token });
    assert(me.status === 200 && me.json?.success, `me failed: ${me.raw}`);

    const badConfirm = await request(baseUrl, 'DELETE', '/api/auth/me', {
      token,
      body: { password, confirmation: 'please' }
    });
    assert(badConfirm.status === 400, 'delete without DELETE confirmation must fail');

    const badPassword = await request(baseUrl, 'DELETE', '/api/auth/me', {
      token,
      body: { password: 'WrongPass1', confirmation: 'DELETE' }
    });
    assert(badPassword.status === 401, 'delete with wrong password must fail');

    const unauth = await request(baseUrl, 'DELETE', '/api/auth/me', {
      body: { password, confirmation: 'DELETE' }
    });
    assert([401, 403].includes(unauth.status), 'delete requires auth');

    // Create an order so we can prove business records survive account deletion.
    const { getClient } = require('../server/database/sqlite/client');
    const db = getClient();
    const catalogId = 930000 + Math.floor(Math.random() * 1000);
    db.prepare(`
      INSERT INTO products (
        catalog_id, category_slug, name, title, price, stock, variants_json, metadata_json, status, visibility
      ) VALUES (?, 'general', ?, ?, 4500, 20, '{}', '{}', 'active', 'both')
    `).run(catalogId, 'Settings Delete Item', 'Settings Delete Item');

    const orderId = `ORD-DELACC-${stamp}`;
    const createOrder = await request(baseUrl, 'POST', '/api/orders', {
      token,
      body: {
        orderId,
        paymentMethod: 'cod',
        items: [{ productId: String(catalogId), quantity: 1, price: 4500, name: 'Settings Delete Item' }],
        shippingAddress: {
          fullName: 'Settings Complete',
          phone,
          provinceCity: 'Kigali',
          district: 'Gasabo',
          sector: 'Remera',
          cell: 'Rukiri',
          village: 'Gisimenti'
        },
        customerName: 'Settings Complete',
        customerPhone: phone
      }
    });
    assert(createOrder.status === 200 || createOrder.status === 201, `order create failed: ${createOrder.raw}`);

    const deleted = await request(baseUrl, 'DELETE', '/api/auth/me', {
      token,
      body: { password, confirmation: 'DELETE' }
    });
    assert(deleted.status === 200 && deleted.json?.success, `delete account failed: ${deleted.raw}`);

    const meAfter = await request(baseUrl, 'GET', '/api/auth/me', { token });
    assert([401, 403].includes(meAfter.status), 'deleted session must not access /me');

    const loginAgain = await request(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: email, password }
    });
    assert(loginAgain.status === 401 || loginAgain.status === 404 || loginAgain.json?.success === false, 'deleted account must not login');

    const orderRow = db.prepare('SELECT order_id, customer_id FROM orders WHERE order_id = ?').get(orderId);
    assert(orderRow && orderRow.order_id === orderId, 'order business record must remain after account deletion');

    const userGone = db.prepare('SELECT public_id FROM users WHERE public_id = ?').get(userId);
    assert(!userGone, 'user row must be removed after account deletion');

    const otherMe = await request(baseUrl, 'GET', '/api/auth/me', { token: otherToken });
    assert(otherMe.status === 200 && otherMe.json?.success, 'other customer session must remain intact');

    const logout = await request(baseUrl, 'POST', '/api/auth/logout', { token: otherToken, body: {} });
    assert(logout.status === 200, `logout failed: ${logout.raw}`);
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
    console.error('FAIL — Customer settings complete verification\n');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('PASS — Customer settings complete verification');
  console.log(' - User Guide / About Us / Danger Zone wiring');
  console.log(' - Secure account deletion + order preservation');
  console.log(' - Logout / session isolation');
}

main().catch((error) => {
  console.error('FAIL — Customer settings complete verification');
  console.error(error);
  process.exit(1);
});
