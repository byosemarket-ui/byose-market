#!/usr/bin/env node
/**
 * Customer authenticated password-change verification.
 * Uses a temporary SQLite database. Does not create live payments.
 *
 * Run: node scripts/verify-customer-password.js
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
  const page = read('account/settings/reset-password.html');
  const js = read('account/js/change-password.js');
  const authService = read('services/authservice.js');
  const controller = read('server/controllers/authcontroller.js');
  const routes = read('server/routes/auth.js');

  assert(page.includes('currentPassword') && page.includes('newPassword') && page.includes('confirmPassword'), 'reset password form has required fields');
  assert(page.includes('change-password.js'), 'reset password page loads change-password.js');
  assert(!page.includes('Placeholder: validation.js'), 'placeholder submit handler removed');
  assert(js.includes('authService.changePassword'), 'client calls authService.changePassword');
  assert(js.includes('isStrongPassword'), 'client validates password strength');
  assert(authService.includes("'/change-password'"), 'authService posts to /change-password');
  assert(controller.includes('comparePasswords'), 'server verifies current password');
  assert(controller.includes('hashPassword'), 'server hashes new password');
  assert(controller.includes('revokeAllForUser'), 'password change revokes other sessions');
  assert(controller.includes('exceptSessionId'), 'current session can remain trusted');
  assert(routes.includes('authSensitiveLimiter') && routes.includes('/change-password'), 'change-password is rate limited');
  assert(!controller.includes('password: rotated') && !/res\.json\(\{[^}]*password:/s.test(controller.split('exports.changePassword')[1] || ''), 'change-password response must not expose password fields');
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byose-customer-password-'));
  const tmpDb = path.join(tmpDir, 'customer-password.sqlite');
  process.env.SQLITE_DB_PATH = tmpDb;
  process.env.DB_CLIENT = 'sqlite';
  process.env.JWT_SECRET = 'customer-password-verify-secret';
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
    const email = `pwd.owner.${stamp}@example.com`;
    const otherEmail = `pwd.other.${stamp}@example.com`;
    const oldPassword = 'OldPass123';
    const newPassword = 'NewPass456';

    const signup = await request(baseUrl, 'POST', '/api/auth/signup', {
      body: { name: 'Password Owner', email, password: oldPassword }
    });
    assert(signup.status === 200 && signup.json?.token, `signup failed: ${signup.raw}`);
    const tokenA = signup.json.token;
    const refreshA = signup.json.refreshToken;

    const other = await request(baseUrl, 'POST', '/api/auth/signup', {
      body: { name: 'Password Other', email: otherEmail, password: 'OtherPass1' }
    });
    assert(other.status === 200 && other.json?.token, `other signup failed: ${other.raw}`);

    const wrongCurrent = await request(baseUrl, 'POST', '/api/auth/change-password', {
      token: tokenA,
      body: { currentPassword: 'WrongPass1', newPassword }
    });
    assert(wrongCurrent.status === 401, 'incorrect current password is rejected');

    const weak = await request(baseUrl, 'POST', '/api/auth/change-password', {
      token: tokenA,
      body: { currentPassword: oldPassword, newPassword: 'short' }
    });
    assert(weak.status === 400, 'weak new password is rejected');

    const same = await request(baseUrl, 'POST', '/api/auth/change-password', {
      token: tokenA,
      body: { currentPassword: oldPassword, newPassword: oldPassword }
    });
    assert(same.status === 400, 'same password as current is rejected');

    const noAuth = await request(baseUrl, 'POST', '/api/auth/change-password', {
      body: { currentPassword: oldPassword, newPassword }
    });
    assert(noAuth.status === 401, 'password change requires authentication');

    const changed = await request(baseUrl, 'POST', '/api/auth/change-password', {
      token: tokenA,
      body: { currentPassword: oldPassword, newPassword }
    });
    assert(changed.status === 200 && changed.json?.success, `password change failed: ${changed.raw}`);
    assert(Boolean(changed.json.token) && Boolean(changed.json.refreshToken), 'password change rotates current session tokens');
    assert(!Object.prototype.hasOwnProperty.call(changed.json, 'password'), 'response does not include password');
    assert(!JSON.stringify(changed.json).includes(oldPassword), 'response does not leak old password');
    assert(!JSON.stringify(changed.json).includes(newPassword), 'response does not leak new password');

    const me = await request(baseUrl, 'GET', '/api/auth/me', { token: changed.json.token });
    assert(me.status === 200 && me.json?.user?.email === email, 'current session remains valid after password change');

    const oldLogin = await request(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: email, password: oldPassword }
    });
    assert(oldLogin.status === 401 || oldLogin.json?.success === false, 'old password no longer works');

    const newLogin = await request(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: email, password: newPassword, rememberMe: true }
    });
    assert(newLogin.status === 200 && newLogin.json?.token, 'new password works for login');

    const steal = await request(baseUrl, 'POST', '/api/auth/change-password', {
      token: other.json.token,
      body: {
        currentPassword: 'OtherPass1',
        newPassword: 'StolenPass1',
        userId: signup.json.user.id,
        id: signup.json.user.id
      }
    });
    assert(steal.status === 200 && steal.json?.success, 'other customer can change only their own password');
    const ownerStill = await request(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: email, password: newPassword }
    });
    assert(ownerStill.status === 200, 'owner password unchanged by other customer request body ids');

    const logout = await request(baseUrl, 'POST', '/api/auth/logout', {
      body: { refreshToken: newLogin.json.refreshToken }
    });
    assert(logout.status === 200, 'logout still works after password change');

    // Original pre-change refresh should no longer be trusted after rotation/revocation path.
    const staleRefresh = await request(baseUrl, 'POST', '/api/auth/refresh', {
      body: { refreshToken: refreshA }
    });
    assert(staleRefresh.status === 401, 'pre-change refresh token is revoked after password change rotation');
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
    console.error('FAIL verify-customer-password');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('Customer password verification passed.');
}

main().catch((error) => {
  console.error('FAIL verify-customer-password');
  console.error(error);
  process.exit(1);
});
