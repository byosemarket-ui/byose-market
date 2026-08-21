#!/usr/bin/env node
/**
 * Customer preferences, language, and notification settings verification.
 * Uses a temporary SQLite database.
 *
 * Run: node scripts/verify-customer-settings.js
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
  const prefsHtml = read('account/settings/preferences.html');
  const langHtml = read('account/settings/language.html');
  const notifHtml = read('account/settings/notifications.html');
  const prefsJs = read('account/js/preferences.js');
  const langJs = read('account/js/language-settings.js');
  const notifJs = read('account/js/notification-settings.js');
  const authController = read('server/controllers/authcontroller.js');
  const notifRepo = read('server/repositories/sqlite/customer-notification.repository.js');
  const migration = read('server/database/sqlite/migrations/033_customer_preferences.sql');

  assert(prefsHtml.includes('preferences.js'), 'preferences page must load preferences.js');
  assert(prefsJs.includes('updateProfile'), 'preferences must save via authService.updateProfile');
  assert(prefsJs.includes('interestCategories'), 'preferences must persist interestCategories');
  assert(!prefsJs.includes("saveBtn.textContent = 'Saved'") || prefsJs.includes('Preferences saved.'), 'preferences must not fake-save without server');

  assert(langHtml.includes('language-settings.js'), 'language page must load language-settings.js');
  assert(langJs.includes('preferredLanguage'), 'language settings must save preferredLanguage');
  assert(!langHtml.includes('{{current_language}}'), 'language page must not keep placeholder');

  assert(notifHtml.includes('notification-settings.js'), 'notifications page must load notification-settings.js');
  assert(notifJs.includes('/api/customer-notifications/prefs'), 'notifications must use existing prefs API');
  assert(notifHtml.includes('Cannot be turned off') || notifHtml.includes('cannot be turned off'), 'system notifications must be locked in UI');
  assert(notifRepo.includes('system: true'), 'server must force system notifications on');

  assert(authController.includes('preferredLanguage'), 'auth me must expose preferredLanguage');
  assert(authController.includes('interestCategories'), 'auth me must accept interestCategories');
  assert(authController.includes('req.user && req.user.id'), 'settings updates must use session user id');
  assert(migration.includes('preferences_json'), 'migration must add preferences_json');
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byose-customer-settings-'));
  const tmpDb = path.join(tmpDir, 'settings.sqlite');
  process.env.SQLITE_DB_PATH = tmpDb;
  process.env.DB_CLIENT = 'sqlite';
  process.env.JWT_SECRET = 'customer-settings-verify-secret';
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
    const emailA = `settings.owner.${stamp}@example.com`;
    const emailB = `settings.other.${stamp}@example.com`;
    const password = 'SettingsPass1';

    const signupA = await request(baseUrl, 'POST', '/api/auth/signup', {
      body: {
        name: 'Settings Owner',
        email: emailA,
        phone: '+250780000301',
        password
      }
    });
    assert(signupA.status === 200 && signupA.json?.success, `owner signup failed: ${signupA.raw}`);
    const tokenA = signupA.json.token;
    const userA = signupA.json.user;

    const signupB = await request(baseUrl, 'POST', '/api/auth/signup', {
      body: {
        name: 'Settings Other',
        email: emailB,
        phone: '+250780000302',
        password
      }
    });
    assert(signupB.status === 200 && signupB.json?.success, `other signup failed: ${signupB.raw}`);
    const tokenB = signupB.json.token;

    const prefsSave = await request(baseUrl, 'PUT', '/api/auth/me', {
      token: tokenA,
      body: {
        preferences: { interestCategories: ['fashion', 'phones', 'bogus'] }
      }
    });
    assert(prefsSave.status === 200, `preferences save failed: ${prefsSave.raw}`);
    assert(
      JSON.stringify(prefsSave.json?.user?.preferences?.interestCategories) === JSON.stringify(['fashion', 'phones']),
      'preferences must validate and store allowed categories only'
    );

    const emptyPrefs = await request(baseUrl, 'PUT', '/api/auth/me', {
      token: tokenA,
      body: { interestCategories: [] }
    });
    assert(emptyPrefs.status === 400, 'empty interest categories must be rejected');

    const meAfterPrefs = await request(baseUrl, 'GET', '/api/auth/me', { token: tokenA });
    assert(
      JSON.stringify(meAfterPrefs.json?.user?.preferences?.interestCategories) === JSON.stringify(['fashion', 'phones']),
      'preferences must persist after reload'
    );

    const langSave = await request(baseUrl, 'PUT', '/api/auth/me', {
      token: tokenA,
      body: { preferredLanguage: 'rw' }
    });
    assert(langSave.status === 200 && langSave.json?.user?.preferredLanguage === 'rw', 'language save must persist preferredLanguage');

    const badLang = await request(baseUrl, 'PUT', '/api/auth/me', {
      token: tokenA,
      body: { preferredLanguage: 'xx' }
    });
    assert(badLang.status === 400, 'unsupported language must be rejected');

    const meAfterLang = await request(baseUrl, 'GET', '/api/auth/me', { token: tokenA });
    assert(meAfterLang.json?.user?.preferredLanguage === 'rw', 'language must remain after GET /me');
    assert(
      JSON.stringify(meAfterLang.json?.user?.preferences?.interestCategories) === JSON.stringify(['fashion', 'phones']),
      'language update must not wipe preferences'
    );

    const loginAgain = await request(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: emailA, password }
    });
    assert(loginAgain.status === 200 && loginAgain.json?.user?.preferredLanguage === 'rw', 'language must survive logout/login');
    assert(
      JSON.stringify(loginAgain.json?.user?.preferences?.interestCategories) === JSON.stringify(['fashion', 'phones']),
      'preferences must survive logout/login'
    );

    const otherStealPrefs = await request(baseUrl, 'PUT', '/api/auth/me', {
      token: tokenB,
      body: {
        id: userA.id,
        preferences: { interestCategories: ['beauty'] },
        preferredLanguage: 'fr'
      }
    });
    assert(otherStealPrefs.status === 200, 'other customer can update own settings');
    assert(otherStealPrefs.json?.user?.id === signupB.json.user.id, 'session ownership must win over body id');
    assert(
      JSON.stringify(otherStealPrefs.json?.user?.preferences?.interestCategories) === JSON.stringify(['beauty']),
      'other customer only updates own preferences'
    );

    const ownerStill = await request(baseUrl, 'GET', '/api/auth/me', { token: tokenA });
    assert(
      JSON.stringify(ownerStill.json?.user?.preferences?.interestCategories) === JSON.stringify(['fashion', 'phones']),
      'owner preferences unchanged by other customer'
    );
    assert(ownerStill.json?.user?.preferredLanguage === 'rw', 'owner language unchanged by other customer');

    const noAuthPrefs = await request(baseUrl, 'PUT', '/api/auth/me', {
      body: { preferences: { interestCategories: ['home'] } }
    });
    assert(noAuthPrefs.status === 401, 'preferences update requires authentication');

    const notifGet = await request(baseUrl, 'GET', '/api/customer-notifications/prefs', { token: tokenA });
    assert(notifGet.status === 200 && notifGet.json?.prefs, `notif prefs get failed: ${notifGet.raw}`);
    assert(notifGet.json.prefs.system === true, 'system notifications default on');

    const notifPut = await request(baseUrl, 'PUT', '/api/customer-notifications/prefs', {
      token: tokenA,
      body: { orders: false, shipping: true, promo: false, system: false }
    });
    assert(notifPut.status === 200, `notif prefs put failed: ${notifPut.raw}`);
    assert(notifPut.json?.prefs?.orders === false, 'orders preference must save');
    assert(notifPut.json?.prefs?.promo === false, 'promo preference must save');
    assert(notifPut.json?.prefs?.system === true, 'system preference must stay forced on');

    const notifReload = await request(baseUrl, 'GET', '/api/customer-notifications/prefs', { token: tokenA });
    assert(notifReload.json?.prefs?.orders === false, 'notif prefs must persist after reload');
    assert(notifReload.json?.prefs?.system === true, 'system must remain on after reload');

    const notifOther = await request(baseUrl, 'GET', '/api/customer-notifications/prefs', { token: tokenB });
    assert(notifOther.status === 200 && notifOther.json?.prefs, 'other customer can load own notification prefs');
    assert(
      Number(notifOther.json.prefs.userId) !== Number(notifReload.json.prefs.userId),
      'notification prefs are scoped by authenticated user'
    );
    assert(notifOther.json.prefs.orders !== false, 'other customer defaults must not inherit owner order toggle');

    const notifNoAuth = await request(baseUrl, 'PUT', '/api/customer-notifications/prefs', {
      body: { orders: false }
    });
    assert(notifNoAuth.status === 401, 'notification prefs require authentication');

    const { getRepositoryBundle } = require('../server/repositories');
    const repos = getRepositoryBundle();
    const owner = await repos.users.findByPublicId(userA.id);
    const customerNotificationDataService = require('../server/services/customernotificationdataservice');

    await customerNotificationDataService.enqueueEventSafe({
      userId: owner.recordId,
      type: 'COUPON_RECEIVED',
      title: 'Promo blocked',
      body: 'should not enqueue'
    });
    await customerNotificationDataService.enqueueEventSafe({
      userId: owner.recordId,
      type: 'SYSTEM',
      title: 'Security always on',
      body: 'must enqueue'
    });
    const listed = await customerNotificationDataService.listNotifications(owner, { limit: 20 });
    assert(
      !listed.items.some((item) => item.title === 'Promo blocked'),
      'promo preference must gate promotional notifications'
    );
    assert(
      listed.items.some((item) => item.title === 'Security always on'),
      'system notifications must still enqueue when system pref is forced on'
    );
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
    console.error('FAIL verify-customer-settings');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('Customer settings verification passed.');
}

main().catch((error) => {
  console.error('FAIL verify-customer-settings');
  console.error(error);
  process.exit(1);
});
