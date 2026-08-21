#!/usr/bin/env node
/**
 * Customer authentication / session persistence verification.
 * Uses a temporary SQLite database. Does not create live orders or payments.
 *
 * Run: node scripts/verify-customer-auth-session.js
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function checkSourceGuards() {
  const authService = read('services/authservice.js');
  const loginJs = read('login.js');
  const loginHtml = read('login.html');
  const logoutJs = read('logout/logout.js');
  const authGuard = read('account/js/auth-guard.js');
  const authController = read('server/controllers/authcontroller.js');
  const authRoutes = read('server/routes/auth.js');
  const apiIndex = read('server/api/index.js');
  const middleware = read('server/middleware/authmiddleware.js');
  const migration = read('server/database/sqlite/migrations/031_customer_sessions.sql');

  assert(authService.includes("REFRESH_TOKEN_KEY = 'bm_refresh_token'"), 'frontend stores a refresh token');
  assert(authService.includes('_migrateLegacyStorage'), 'frontend migrates sessionStorage tokens into localStorage');
  assert(authService.includes('localStorage.setItem(TOKEN_KEY'), 'access token is persisted in localStorage');
  assert(!authService.includes('remember ? localStorage : sessionStorage'), 'login must not use sessionStorage as the primary auth store');
  assert(authService.includes("if (_isDefinitiveAuthFailure(error))"), 'session is cleared only on definitive auth failures');
  assert(authService.includes('async function logout'), 'logout revokes the server session');
  assert(authService.includes("'/refresh'"), 'frontend can refresh an expired access token');
  assert(authService.includes('isLocalHost(hostname)'), 'local development must not force the production API origin');
  assert(loginHtml.includes('id="rememberMe"') && /rememberMe[^>]*checked/.test(loginHtml), 'Remember me is checked by default');
  assert(!loginJs.includes('passwordInputLogin.value = lastPwd'), 'login must not restore passwords from storage');
  assert(logoutJs.includes('bm_refresh_token'), 'logout clears the refresh token');
  assert(logoutJs.includes('await Promise.race'), 'logout waits for session revocation before redirect');
  assert(logoutJs.includes('location.replace'), 'logout redirects with history replace');
  assert(authService.includes('mergeGuestCart: true'), 'guest cart merges only on login/signup, not on every restore');
  assert(authService.includes('function whenReady'), 'session restore starts as soon as the site loads');
  assert(authService.includes('keepalive: true'), 'logout request can complete after the page navigates away');
  assert(authService.includes("AUTH_EPOCH_KEY = 'bm_auth_epoch'"), 'logout invalidates in-flight session restores');
  assert(authGuard.includes('whenReady'), 'account pages wait for session restoration');
  assert(authGuard.includes('pageshow'), 'account pages re-check auth after history navigation');
  assert(authGuard.includes('event.persisted'), 'back-forward cache cannot keep a logged-out account visible');
  assert(authGuard.includes("location.replace"), 'unauthenticated account access is replaced, not stacked in history');
  assert(read('account/js/account.js').includes("addEventListener('userUpdated'"), 'account header stays in sync with auth state');
  assert(read('js/header.js').includes("addEventListener('userUpdated'"), 'storefront header stays in sync with auth state');
  assert(read('account/js/dashboard-data.js').includes('whenReady'), 'account dashboard waits for restored session');
  assert(read('account/account.html').includes('http-equiv="Cache-Control"'), 'account HTML is marked no-store');
  assert(read('logout/logout.html').includes('http-equiv="Cache-Control"'), 'logout HTML is marked no-store');
  assert(authController.includes('issueCustomerSession'), 'signup/login issue a revocable customer session');
  assert(authController.includes('exports.refresh'), 'refresh endpoint exists');
  assert(authController.includes('exports.logout'), 'logout endpoint exists');
  assert(authController.includes('ignoreExpiration: true'), 'logout revokes the session even if the access token already expired');
  assert(authRoutes.includes("router.post('/refresh'"), 'refresh route is registered');
  assert(authRoutes.includes("router.post('/logout'"), 'logout route is registered');
  assert(authRoutes.includes("Cache-Control', 'no-store"), 'auth API responses are not cached');
  assert(!apiIndex.includes("router.use('/auth', authRateLimiter"), 'GET /me is not behind the old 20/15m auth limiter');
  assert(middleware.includes('TOKEN_EXPIRED'), 'expired access tokens are distinguishable from revoked sessions');
  assert(middleware.includes('findActiveBySessionId'), 'protected routes require an active customer session');
  assert(middleware.includes('no-store'), 'protected customer APIs are not cached');
  assert(read('server/utils/token.js').includes('function readAccessTokenClaims'), 'expired access tokens can still identify the session to revoke');
  assert(read('server/app.js').includes("normalizedPath.includes('/account/')"), 'account pages are served with no-store');
  assert(migration.includes('CREATE TABLE IF NOT EXISTS customer_sessions'), 'customer_sessions migration exists');
  assert(read('account/shared/storage.js').includes('window.authService.isLoggedIn'), 'legacy storage helpers defer to authService');
  assert(read('account/shared/storage.js').includes("typeof window.authService.isLoggedIn === 'function'"), 'legacy storage does not overwrite an active authService');
  assert(!read('admin/app/core/auth.js').includes('customer_sessions'), 'admin auth does not use customer sessions');
  assert(!read('admin/app/core/auth.js').includes('bm_refresh_token'), 'admin auth does not use customer refresh tokens');
  assert(!read('server/services/adminsecurityservice.js').includes('customer_sessions'), 'admin sessions stay on admin_sessions');
}

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(String(key)) ? data.get(String(key)) : null;
    },
    setItem(key, value) {
      data.set(String(key), String(value));
    },
    removeItem(key) {
      data.delete(String(key));
    },
    _dump() {
      return Object.fromEntries(data);
    }
  };
}

function loadAuthService({ localStorage, sessionStorage, fetchImpl }) {
  const source = fs.readFileSync(path.join(root, 'services/authservice.js'), 'utf8');
  const sandbox = {
    console,
    localStorage,
    sessionStorage,
    atob,
    btoa,
    fetch: fetchImpl || (async () => ({
      ok: false,
      status: 500,
      headers: { get: () => 'application/json' },
      json: async () => ({})
    })),
    document: { addEventListener() {}, readyState: 'complete' },
    CustomEvent: class CustomEvent {
      constructor(name, init) {
        this.type = name;
        this.detail = init && init.detail;
      }
    }
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.dispatchEvent = () => true;
  vm.runInNewContext(source, sandbox, { filename: 'authservice.js' });
  return sandbox.authService;
}

function makeJwt(expiresInSeconds = 3600) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64').replace(/=+$/, '');
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    id: 'BM00001'
  })).toString('base64').replace(/=+$/, '');
  return `${header}.${payload}.sig`;
}

function seedPersistentSession(localStorage, user, token, refreshToken) {
  localStorage.setItem('bm_auth_token', token);
  localStorage.setItem('bm_refresh_token', refreshToken);
  localStorage.setItem('bm_current_user', JSON.stringify(user));
  localStorage.setItem('bm_user', JSON.stringify(user));
  localStorage.setItem('byose_market_user', JSON.stringify(user));
  localStorage.setItem('bm_logged_in', 'true');
  localStorage.setItem('bm_remember_me', '1');
}

function checkPersistentLoginFlow() {
  const user = {
    id: 'BM00001',
    name: 'Ada',
    email: 'ada@example.com',
    phone: '',
    status: 'active'
  };
  const token = makeJwt(60 * 60);
  const localStorage = createMemoryStorage();
  seedPersistentSession(localStorage, user, token, 'refresh-keep-alive');

  const afterSignIn = loadAuthService({ localStorage, sessionStorage: createMemoryStorage() });
  assert(afterSignIn.isLoggedIn() === true, 'sign-in remains authenticated');
  assert(afterSignIn.getCurrentUser()?.id === 'BM00001', 'account identity is available after sign-in');

  const afterRefresh = loadAuthService({ localStorage, sessionStorage: createMemoryStorage() });
  assert(afterRefresh.isLoggedIn() === true, 'page refresh keeps the customer signed in');
  assert(afterRefresh.getCurrentUser()?.name === 'Ada', 'account state is not reset on refresh');

  const afterNavigate = loadAuthService({ localStorage, sessionStorage: createMemoryStorage() });
  assert(afterNavigate.isLoggedIn() === true, 'navigation keeps the customer signed in');
  assert(typeof afterNavigate.whenReady === 'function', 'session restoration API is available on every page');

  const afterBrowserRestart = loadAuthService({ localStorage, sessionStorage: createMemoryStorage() });
  assert(afterBrowserRestart.isLoggedIn() === true, 'browser restart keeps the customer signed in');
  assert(afterBrowserRestart.getCurrentUser()?.id === 'BM00001', 'returning to account after reopen still sees the same customer');
  assert(afterBrowserRestart.getRefreshToken() === 'refresh-keep-alive', 'refresh token survives browser close');
}

function checkFrontendPersistence() {
  const localStorage = createMemoryStorage();
  const sessionStorage = createMemoryStorage();
  const authService = loadAuthService({ localStorage, sessionStorage });

  sessionStorage.setItem('bm_auth_token', 'stale-session-token');
  sessionStorage.setItem('bm_current_user', JSON.stringify({ id: 'BM00001', name: 'Ada', email: 'ada@example.com' }));
  sessionStorage.setItem('bm_logged_in', 'true');

  const user = {
    id: 'BM00001',
    name: 'Ada',
    email: 'ada@example.com',
    phone: '',
    status: 'active'
  };

  authService.setCurrentUser(user);
  assert(Boolean(localStorage.getItem('bm_auth_token')), 'migrated token lands in localStorage');
  assert(!sessionStorage.getItem('bm_auth_token'), 'sessionStorage token is cleared after migrate/persist');

  localStorage.setItem('bm_auth_token', 'header.e30.sig');
  localStorage.setItem('bm_refresh_token', 'refresh-token');
  localStorage.setItem('bm_current_user', JSON.stringify(user));
  localStorage.setItem('bm_logged_in', 'true');
  assert(authService.isLoggedIn() === true, 'refresh token keeps the customer logged in when access JWT is unreadable/expired');
  assert(Boolean(localStorage.getItem('bm_refresh_token')), 'isLoggedIn must not wipe a refreshable session');
}

async function checkLogoutClearsFrontend() {
  const user = {
    id: 'BM00001',
    name: 'Ada',
    email: 'ada@example.com',
    phone: '',
    status: 'active'
  };
  const localStorage = createMemoryStorage();
  seedPersistentSession(localStorage, user, makeJwt(60 * 60), 'refresh-keep-alive');
  const calls = [];
  const authService = loadAuthService({
    localStorage,
    sessionStorage: createMemoryStorage(),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options: options || {} });
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, user })
      };
    }
  });

  assert(authService.isLoggedIn() === true, 'customer is authenticated before logout');
  await authService.logout();
  assert(authService.isLoggedIn() === false, 'logout clears authenticated state immediately');
  assert(!localStorage.getItem('bm_auth_token'), 'logout removes the access token');
  assert(!localStorage.getItem('bm_refresh_token'), 'logout removes the persistent refresh token');
  assert(!localStorage.getItem('bm_current_user'), 'logout removes cached account identity');
  assert(!localStorage.getItem('bm_logged_in'), 'logout removes the logged-in flag');
  const logoutCall = calls.find((call) => call.url.includes('/logout'));
  assert(Boolean(logoutCall), 'logout revokes the server session');
  assert(logoutCall.options.keepalive === true, 'logout request survives page navigation');

  const afterReturn = loadAuthService({ localStorage, sessionStorage: createMemoryStorage() });
  assert(afterReturn.isLoggedIn() === false, 'returning to the website does not restore the logged-out session');
  assert(!afterReturn.getRefreshToken(), 'refreshing after logout does not revive persistent login');
}

async function request(baseUrl, method, routePath, { token = '', body = null } = {}) {
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
        resolve({
          status: res.statusCode || 0,
          json,
          raw,
          headers: res.headers || {}
        });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runHttpScenarios() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byose-customer-auth-'));
  const tmpDb = path.join(tmpDir, 'customer-auth.sqlite');
  process.env.SQLITE_DB_PATH = tmpDb;
  process.env.DB_CLIENT = 'sqlite';
  process.env.JWT_SECRET = 'customer-auth-verify-secret';
  process.env.NODE_ENV = 'test';

  const { connectDatabase, closeDatabase } = require('../server/database');
  await connectDatabase();

  const express = require('express');
  const createApiRouter = require('../server/api');
  const jwt = require('jsonwebtoken');
  const customerSessionRepository = require('../server/repositories/sqlite/customer-session.repository');

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', createApiRouter());

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const email = `auth.persist.${Date.now()}@example.com`;
    const password = 'PersistPass1';

    const signup = await request(baseUrl, 'POST', '/api/auth/signup', {
      body: { name: 'Persist User', email, password }
    });
    assert(signup.status === 200 && signup.json?.success, `signup failed: ${signup.raw}`);
    assert(Boolean(signup.json.token), 'signup returns an access token');
    assert(Boolean(signup.json.refreshToken), 'signup returns a refresh token');
    assert(Boolean(signup.json.user?.id), 'signup returns a customer record');

    const me = await request(baseUrl, 'GET', '/api/auth/me', { token: signup.json.token });
    assert(me.status === 200 && me.json?.user?.email === email, `authenticated /me failed: ${me.raw}`);

    const refreshed = await request(baseUrl, 'POST', '/api/auth/refresh', {
      body: { refreshToken: signup.json.refreshToken }
    });
    assert(refreshed.status === 200 && refreshed.json?.success, `refresh failed: ${refreshed.raw}`);
    assert(refreshed.json.refreshToken !== signup.json.refreshToken, 'refresh token is rotated');
    const reused = await request(baseUrl, 'POST', '/api/auth/refresh', {
      body: { refreshToken: signup.json.refreshToken }
    });
    assert(reused.status === 401, 'old refresh token is rejected after rotation');

    const expiredSid = jwt.decode(refreshed.json.token).sid;
    const nowSec = Math.floor(Date.now() / 1000);
    const { getJwtConfig } = require('../server/utils/token');
    const jwtConfig = getJwtConfig();
    const expiredAccess = jwt.sign(
      {
        id: signup.json.user.id,
        email,
        role: 'user',
        sid: expiredSid,
        iat: nowSec - 120,
        exp: nowSec - 60
      },
      jwtConfig.secret,
      {
        algorithm: 'HS256',
        issuer: process.env.JWT_ISSUER || 'byosemarket-api',
        audience: process.env.JWT_AUDIENCE || 'byosemarket-clients',
        subject: signup.json.user.id
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const expiredMe = await request(baseUrl, 'GET', '/api/auth/me', { token: expiredAccess });
    assert(expiredMe.status === 401 && expiredMe.json?.code === 'TOKEN_EXPIRED', `expired access should return TOKEN_EXPIRED, got ${expiredMe.raw}`);
    const restored = await request(baseUrl, 'POST', '/api/auth/refresh', {
      body: { refreshToken: refreshed.json.refreshToken }
    });
    assert(restored.status === 200 && restored.json?.success, `refresh after expiry failed: ${restored.raw}`);
    const restoredMe = await request(baseUrl, 'GET', '/api/auth/me', { token: restored.json.token });
    assert(restoredMe.status === 200 && restoredMe.json?.user?.id === signup.json.user.id, 'customer account is restored after access token expiry');

    const otherEmail = `auth.other.${Date.now()}@example.com`;
    const otherSignup = await request(baseUrl, 'POST', '/api/auth/signup', {
      body: { name: 'Other User', email: otherEmail, password }
    });
    assert(otherSignup.status === 200 && otherSignup.json?.success, `second customer signup failed: ${otherSignup.raw}`);
    const otherMe = await request(baseUrl, 'GET', '/api/auth/me', { token: otherSignup.json.token });
    const firstMe = await request(baseUrl, 'GET', '/api/auth/me', { token: restored.json.token });
    assert(firstMe.json?.user?.id === signup.json.user.id, 'customer A token still returns customer A');
    assert(otherMe.json?.user?.id === otherSignup.json.user.id, 'customer B token returns customer B');
    assert(firstMe.json?.user?.id !== otherMe.json?.user?.id, 'one customer cannot access another customer account');

    const login = await request(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: email, password, rememberMe: false }
    });
    assert(login.status === 200 && login.json?.success, `login failed: ${login.raw}`);
    assert(Boolean(login.json.refreshToken), 'login without remember-me still issues a persistent refresh token');

    const sessions = customerSessionRepository.db.prepare(
      'SELECT COUNT(*) AS count FROM customer_sessions WHERE user_public_id = ? AND revoked_at IS NULL'
    ).get(signup.json.user.id);
    assert(Number(sessions.count) >= 2, 'login creates a server-side customer session');

    const logout = await request(baseUrl, 'POST', '/api/auth/logout', {
      token: login.json.token,
      body: { refreshToken: login.json.refreshToken }
    });
    assert(logout.status === 200 && logout.json?.success, `logout failed: ${logout.raw}`);
    const afterLogout = await request(baseUrl, 'GET', '/api/auth/me', { token: login.json.token });
    assert(afterLogout.status === 401 && afterLogout.json?.code === 'SESSION_REVOKED', `logout must revoke the session, got ${afterLogout.raw}`);
    assert(String(afterLogout.headers['cache-control'] || '').includes('no-store'), 'revoked account responses are not cached');

    const afterLogoutRefresh = await request(baseUrl, 'POST', '/api/auth/refresh', {
      body: { refreshToken: login.json.refreshToken }
    });
    assert(afterLogoutRefresh.status === 401, `refresh after logout must fail, got ${afterLogoutRefresh.raw}`);

    const protectedOrders = await request(baseUrl, 'GET', '/api/orders', { token: login.json.token });
    assert(protectedOrders.status === 401, `protected orders after logout must fail, got ${protectedOrders.raw}`);
    const anonymousOrders = await request(baseUrl, 'GET', '/api/orders');
    assert(anonymousOrders.status === 401, `protected orders without auth must fail, got ${anonymousOrders.raw}`);

    const loginAgain = await request(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: email, password, rememberMe: true }
    });
    assert(loginAgain.status === 200 && loginAgain.json?.success, `login again failed: ${loginAgain.raw}`);
    assert(Boolean(loginAgain.json.token) && loginAgain.json.token !== login.json.token, 'login again issues a new access token');
    assert(Boolean(loginAgain.json.refreshToken) && loginAgain.json.refreshToken !== login.json.refreshToken, 'login again issues a new refresh token');

    const loginAgainMe = await request(baseUrl, 'GET', '/api/auth/me', { token: loginAgain.json.token });
    assert(loginAgainMe.status === 200 && loginAgainMe.json?.user?.id === signup.json.user.id, 'login again restores account access');
    assert(String(loginAgainMe.headers['cache-control'] || '').includes('no-store'), 'account API responses are not cached');

    const oldTokenStillRevoked = await request(baseUrl, 'GET', '/api/auth/me', { token: login.json.token });
    assert(oldTokenStillRevoked.status === 401, 'previous session stays revoked after login again');

    const ordersAuthed = await request(baseUrl, 'GET', '/api/orders', { token: loginAgain.json.token });
    assert(ordersAuthed.status === 200 && Array.isArray(ordersAuthed.json?.orders), `authenticated orders failed: ${ordersAuthed.raw}`);

    const expiredLogoutSid = jwt.decode(loginAgain.json.token).sid;
    const expiredLogoutNow = Math.floor(Date.now() / 1000);
    const expiredAccessForLogout = jwt.sign(
      {
        id: signup.json.user.id,
        email,
        role: 'user',
        sid: expiredLogoutSid,
        iat: expiredLogoutNow - 120,
        exp: expiredLogoutNow - 60
      },
      jwtConfig.secret,
      {
        algorithm: 'HS256',
        issuer: process.env.JWT_ISSUER || 'byosemarket-api',
        audience: process.env.JWT_AUDIENCE || 'byosemarket-clients',
        subject: signup.json.user.id
      }
    );
    const expiredLogout = await request(baseUrl, 'POST', '/api/auth/logout', {
      token: expiredAccessForLogout,
      body: { refreshToken: loginAgain.json.refreshToken }
    });
    assert(expiredLogout.status === 200 && expiredLogout.json?.success, `logout with expired access failed: ${expiredLogout.raw}`);
    const afterExpiredLogout = await request(baseUrl, 'GET', '/api/auth/me', { token: loginAgain.json.token });
    assert(afterExpiredLogout.status === 401 && afterExpiredLogout.json?.code === 'SESSION_REVOKED', `expired-access logout must still revoke the session, got ${afterExpiredLogout.raw}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  checkSourceGuards();
  checkFrontendPersistence();
  checkPersistentLoginFlow();
  await checkLogoutClearsFrontend();
  await runHttpScenarios();

  if (failures.length) {
    console.error('CUSTOMER AUTH SESSION VERIFY FAILED');
    failures.forEach((failure) => console.error(` - ${failure}`));
    process.exit(1);
  }

  console.log('CUSTOMER AUTH SESSION VERIFY PASSED');
  process.exit(0);
}

main().catch((error) => {
  console.error('CUSTOMER AUTH SESSION VERIFY FAILED');
  console.error(error);
  process.exit(1);
});
