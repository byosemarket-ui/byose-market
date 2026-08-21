#!/usr/bin/env node
/**
 * Customer profile verification.
 * Uses a temporary SQLite database. Does not create live orders or payments.
 *
 * Run: node scripts/verify-customer-profile.js
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
  const profileHtml = read('account/settings/profile.html');
  const profileJs = read('account/js/profile.js');
  const settingsJs = read('account/js/settings.js');
  const userDisplay = read('account/js/user-display.js');
  const authService = read('services/authservice.js');
  const authRoutes = read('server/routes/auth.js');
  const authController = read('server/controllers/authcontroller.js');

  assert(!settingsHtml.includes('{{user.name}}'), 'settings must not show {{user.name}} placeholder');
  assert(!settingsHtml.includes('{{user.avatar}}'), 'settings must not show {{user.avatar}} placeholder');
  assert(!/\{\{user\./.test(profileHtml), 'profile page must not keep {{user.*}} placeholders');
  assert(!profileHtml.includes('nickname'), 'profile must not invent unsupported nickname field');
  assert(!profileHtml.includes('friendCode'), 'profile must not invent friend code field');
  assert(settingsHtml.includes('settings.js'), 'settings page must load settings binder');
  assert(settingsHtml.includes('user-display.js'), 'settings page must load avatar helpers');
  assert(profileHtml.includes('profile.js'), 'profile page must load profile binder');
  assert(profileJs.includes('updateProfile'), 'profile.js must save via authService.updateProfile');
  assert(profileJs.includes('uploadProfilePhoto'), 'profile.js must upload photos via authService');
  assert(settingsJs.includes('paintAvatar'), 'settings binder must paint real user data');
  assert(userDisplay.includes('getNameInitial'), 'initials avatar helper must exist');
  assert(userDisplay.includes("split(/\\s+/)"), 'initial helper uses first name word');
  assert(authService.includes('uploadProfilePhoto'), 'authService must expose photo upload');
  assert(authService.includes('removeProfilePhoto'), 'authService must expose photo remove');
  assert(authRoutes.includes('/me/photo'), 'auth routes must expose /me/photo');
  assert(authController.includes('uploadMePhoto'), 'auth controller must implement customer photo upload');
  assert(authController.includes('req.user && req.user.id'), 'profile updates must use authenticated session user id');
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

function getNameInitial(name) {
  const first = String(name || '').trim().split(/\s+/).filter(Boolean)[0] || '';
  const letter = first.charAt(0).toUpperCase();
  return /[A-Z0-9]/i.test(letter) ? letter : 'B';
}

async function runHttpScenarios() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byose-customer-profile-'));
  const tmpDb = path.join(tmpDir, 'customer-profile.sqlite');
  process.env.SQLITE_DB_PATH = tmpDb;
  process.env.DB_CLIENT = 'sqlite';
  process.env.JWT_SECRET = 'customer-profile-verify-secret';
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
    const emailA = `profile.owner.${stamp}@example.com`;
    const emailB = `profile.other.${stamp}@example.com`;
    const phoneA = '+250780000201';
    const phoneB = '+250780000202';
    const password = 'ProfilePass1';

    const signupA = await request(baseUrl, 'POST', '/api/auth/signup', {
      body: { name: 'Kwizera Evode', email: emailA, phone: phoneA, password }
    });
    assert(signupA.status === 200 && signupA.json?.success, `owner signup failed: ${signupA.raw}`);
    const tokenA = signupA.json.token;
    const userA = signupA.json.user;
    assert(tokenA && userA?.id, 'owner signup must return token and user');

    const signupB = await request(baseUrl, 'POST', '/api/auth/signup', {
      body: { name: 'Jean Paul', email: emailB, phone: phoneB, password }
    });
    assert(signupB.status === 200 && signupB.json?.success, `other signup failed: ${signupB.raw}`);
    const tokenB = signupB.json.token;

    const me = await request(baseUrl, 'GET', '/api/auth/me', { token: tokenA });
    assert(me.status === 200 && me.json?.user?.name === 'Kwizera Evode', 'GET /me must return authenticated customer name');
    assert(me.json?.user?.email === emailA, 'GET /me must return authenticated customer email');

    const update = await request(baseUrl, 'PUT', '/api/auth/me', {
      token: tokenA,
      body: { name: 'Kwizera Evode Updated', email: emailA, phone: phoneA }
    });
    assert(update.status === 200 && update.json?.user?.name === 'Kwizera Evode Updated', 'PUT /me must update own name');

    const conflict = await request(baseUrl, 'PUT', '/api/auth/me', {
      token: tokenB,
      body: { name: 'Jean Paul', email: emailA, phone: phoneB }
    });
    assert(conflict.status === 409, 'cannot take another customer email');

    const steal = await request(baseUrl, 'PUT', '/api/auth/me', {
      token: tokenB,
      body: { name: 'Hacker', email: emailB, phone: phoneB, id: userA.id }
    });
    assert(steal.status === 200 && steal.json?.user?.id === signupB.json.user.id, 'session user id wins over body id');
    assert(steal.json?.user?.name === 'Hacker', 'other customer updates only their own profile');

    const ownerAgain = await request(baseUrl, 'GET', '/api/auth/me', { token: tokenA });
    assert(ownerAgain.json?.user?.name === 'Kwizera Evode Updated', 'owner profile remains unchanged by other customer');

    const noAuth = await request(baseUrl, 'PUT', '/api/auth/me', {
      body: { name: 'No Auth' }
    });
    assert(noAuth.status === 401, 'profile update requires authentication');

    assert(getNameInitial('Kwizera Evode') === 'K', 'initial avatar uses first letter of first name');
    assert(getNameInitial('Jean Paul') === 'J', 'initial avatar uses first letter for Jean Paul');
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
    console.error('FAIL verify-customer-profile');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('Customer profile verification passed.');
}

main().catch((error) => {
  console.error('FAIL verify-customer-profile');
  console.error(error);
  process.exit(1);
});
