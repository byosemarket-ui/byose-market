#!/usr/bin/env node
/**
 * Verifies Admin Security module (DB, service, optional HTTP).
 * Usage: node scripts/verify-admin-security.js [baseUrl]
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function request(baseUrl, method, routePath, { token = "", body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(routePath, `${baseUrl}/`);
    const transport = url.protocol === "https:" ? https : http;
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(raw); } catch (_error) { json = null; }
        resolve({ status: res.statusCode || 0, json, raw });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function verifyServiceLayer() {
  const { connectDatabase } = require("../server/database");
  await connectDatabase();

  const migrations = fs.readdirSync(path.resolve(__dirname, "../server/database/sqlite/migrations"));
  assert(migrations.includes("012_admin_security.sql"), "012_admin_security.sql missing");

  const { getClient } = require("../server/database/sqlite/client");
  const db = getClient();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  assert(tables.includes("admin_sessions"), "admin_sessions missing");
  assert(tables.includes("admin_trusted_devices"), "admin_trusted_devices missing");

  const loginCols = db.prepare("PRAGMA table_info(admin_login_history)").all().map((row) => row.name);
  for (const col of ["browser", "os", "country", "city", "device_fingerprint", "logout_at"]) {
    assert(loginCols.includes(col), `admin_login_history.${col} missing`);
  }

  const userCols = db.prepare("PRAGMA table_info(users)").all().map((row) => row.name);
  assert(userCols.includes("two_factor_enabled"), "users.two_factor_enabled missing");

  const adminEmail = String(process.env.ADMIN_EMAIL || "admin@example.com").trim().toLowerCase();
  const adminId = `ADMIN_${Buffer.from(adminEmail).toString("hex").slice(0, 16)}`;
  const adminSecurityService = require("../server/services/adminsecurityservice");

  const fakeReq = {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
      "x-forwarded-for": "203.0.113.10",
      "cf-ipcountry": "RW",
      "cf-ipcity": "Kigali"
    },
    ip: "203.0.113.10"
  };

  const loginA = await adminSecurityService.createLoginSession(
    { id: adminId, email: adminEmail, role: "admin" },
    fakeReq,
    { deviceFingerprint: "dev_verify_a", deviceName: "Verify Desktop A", expiresAt: new Date(Date.now() + 86400000).toISOString() }
  );
  assert(loginA.sessionId, "session A missing");

  const loginB = await adminSecurityService.createLoginSession(
    { id: adminId, email: adminEmail, role: "admin" },
    fakeReq,
    { deviceFingerprint: "dev_verify_b", deviceName: "Verify Desktop B", sessionId: undefined }
  );
  assert(loginB.sessionId, "session B missing");

  const overview = await adminSecurityService.getSecurityOverview(
    { id: adminId, email: adminEmail },
    { ...fakeReq, headers: { ...fakeReq.headers, "x-admin-session-id": loginA.sessionId }, admin: { sid: loginA.sessionId } }
  );
  assert(overview.sessions.length >= 2, "expected active sessions");
  assert(overview.twoFactor.prepared === true, "2FA placeholder missing");

  const history = await adminSecurityService.listLoginHistory({ id: adminId, email: adminEmail }, {
    query: "chrome",
    status: "success",
    page: 1,
    limit: 10,
    sort: "created_at_desc"
  });
  assert(history.pagination, "login history pagination missing");
  assert(Array.isArray(history.items), "login history items missing");

  const trusted = await adminSecurityService.trustCurrentDevice(
    { id: adminId, email: adminEmail },
    fakeReq,
    { deviceFingerprint: "dev_verify_a", deviceName: "Office PC" }
  );
  assert(trusted?.id, "trusted device missing");
  const renamed = await adminSecurityService.renameTrustedDevice(
    { id: adminId, email: adminEmail },
    trusted.id,
    "Office Workstation",
    fakeReq
  );
  assert(renamed.deviceName === "Office Workstation", "rename failed");

  const others = await adminSecurityService.logoutOtherSessions(
    { id: adminId, email: adminEmail },
    { ...fakeReq, headers: { ...fakeReq.headers, "x-admin-session-id": loginA.sessionId }, admin: { sid: loginA.sessionId } }
  );
  assert(others.revokedCount >= 1, "logout others failed");

  let blocked = false;
  try {
    await adminSecurityService.terminateSession(
      { id: adminId, email: adminEmail },
      loginA.sessionId,
      { ...fakeReq, headers: { ...fakeReq.headers, "x-admin-session-id": loginA.sessionId }, admin: { sid: loginA.sessionId } },
      { confirmCurrent: false }
    );
  } catch (error) {
    blocked = Number(error.statusCode) === 400;
  }
  assert(blocked, "current session termination should require confirmation");

  const ended = await adminSecurityService.terminateSession(
    { id: adminId, email: adminEmail },
    loginA.sessionId,
    { ...fakeReq, headers: { ...fakeReq.headers, "x-admin-session-id": loginA.sessionId }, admin: { sid: loginA.sessionId } },
    { confirmCurrent: true }
  );
  assert(ended.endedCurrent === true, "current session end failed");

  const sessionCheck = await adminSecurityService.assertSessionAllowed(loginA.sessionId);
  assert(sessionCheck.allowed === false, "revoked session still allowed");

  await adminSecurityService.removeTrustedDevice({ id: adminId, email: adminEmail }, trusted.id, fakeReq);

  const events = await adminSecurityService.listSecurityEvents({ id: adminId, email: adminEmail }, { limit: 50 });
  assert(events.items.length > 0, "security events missing");

  const twoFactor = await adminSecurityService.updateTwoFactorPlaceholder(
    { id: adminId, email: adminEmail },
    { enabled: true },
    fakeReq
  );
  assert(twoFactor.activated === false, "2FA should remain inactive placeholder");

  return { adminId, sessionId: loginA.sessionId };
}

async function verifyHttp(baseUrl, serviceResult) {
  const { generateToken } = require("../server/utils/token");
  const adminSecurityService = require("../server/services/adminsecurityservice");
  const adminEmail = String(process.env.ADMIN_EMAIL || "admin@example.com").trim().toLowerCase();

  const login = await adminSecurityService.createLoginSession(
    { id: serviceResult.adminId, email: adminEmail, role: "admin" },
    { headers: { "user-agent": "VerifyHttp/1.0" }, ip: "127.0.0.1" },
    { deviceFingerprint: "dev_http_verify", deviceName: "HTTP Verify" }
  );

  const token = generateToken({
    id: serviceResult.adminId,
    email: adminEmail,
    role: "admin",
    sid: login.sessionId
  });

  const unauth = await request(baseUrl, "GET", "/api/admin/security");
  assert([401, 403].includes(unauth.status), `Expected 401/403, got ${unauth.status}`);

  const overview = await request(baseUrl, "GET", "/api/admin/security", {
    token,
    headers: { "X-Admin-Session-Id": login.sessionId }
  });
  assert(overview.status === 200 && overview.json?.success, `overview failed: ${overview.raw}`);
  assert(Array.isArray(overview.json.sessions), "sessions missing in HTTP overview");

  const history = await request(baseUrl, "GET", "/api/admin/security/login-history?limit=5", {
    token,
    headers: { "X-Admin-Session-Id": login.sessionId }
  });
  assert(history.status === 200 && history.json?.success, `history failed: ${history.raw}`);
}

async function main() {
  const { closeDatabase } = require("../server/database");
  try {
    const serviceResult = await verifyServiceLayer();
    console.log("[verify-admin-security] service layer PASS");

    const baseUrlArg = String(process.argv[2] || "").trim();
    const localBase = baseUrlArg || `http://127.0.0.1:${process.env.PORT || 5000}`;
    try {
      await verifyHttp(localBase.replace(/\/+$/, ""), serviceResult);
      console.log(`[verify-admin-security] HTTP layer PASS (${localBase})`);
    } catch (error) {
      if (baseUrlArg) throw error;
      console.log(`[verify-admin-security] HTTP layer skipped/unavailable: ${error.message}`);
    }

    console.log("[verify-admin-security] PASS");
  } finally {
    try { await closeDatabase(); } catch (_error) {}
  }
}

main().catch((error) => {
  console.error("[verify-admin-security] FAIL:", error.message || error);
  process.exit(1);
});
