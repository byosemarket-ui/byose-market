#!/usr/bin/env node
/**
 * Verifies Admin Logout & Session Management module.
 * Usage: node scripts/verify-admin-logout.js [baseUrl]
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

  const adminSecurityService = require("../server/services/adminsecurityservice");
  const generalSettingsService = require("../server/services/generalsettings.service");

  const adminEmail = String(process.env.ADMIN_EMAIL || "admin@example.com").trim().toLowerCase();
  const adminId = `ADMIN_${Buffer.from(adminEmail).toString("hex").slice(0, 16)}`;
  const admin = { id: adminId, email: adminEmail, role: "admin" };

  const beforePolicy = await adminSecurityService.getSessionPolicy();
  assert(beforePolicy.sessionDurationHours >= 1, "default session duration missing");

  const updatedPolicy = await adminSecurityService.updateSessionPolicy({
    sessionDurationHours: 72,
    idleTimeoutHours: 6,
    enforceServerExpiry: true
  }, admin);
  assert(updatedPolicy.sessionDurationHours === 72, "session duration not saved");
  assert(updatedPolicy.idleTimeoutHours === 6, "idle timeout not saved");

  const tokenOptions = await adminSecurityService.resolveLoginTokenOptions();
  assert(tokenOptions.expiresIn === "3d", `expected 3d expiresIn, got ${tokenOptions.expiresIn}`);

  const general = await generalSettingsService.getGeneralSettings();
  assert(general.storeName, "general settings wiped by session policy");

  const fakeReq = {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
      "x-forwarded-for": "203.0.113.55",
      "x-admin-session-id": ""
    },
    admin: { ...admin, sid: "" },
    ip: "203.0.113.55"
  };

  const loginA = await adminSecurityService.createLoginSession(admin, fakeReq, {
    sessionId: `sess_verify_a_${Date.now()}`,
    deviceFingerprint: "dev_verify_a",
    deviceName: "Verify Device A",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  });
  const loginB = await adminSecurityService.createLoginSession(admin, fakeReq, {
    sessionId: `sess_verify_b_${Date.now()}`,
    deviceFingerprint: "dev_verify_b",
    deviceName: "Verify Device B",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  });

  fakeReq.headers["x-admin-session-id"] = loginA.sessionId;
  fakeReq.admin.sid = loginA.sessionId;

  const overview = await adminSecurityService.getSecurityOverview(admin, fakeReq);
  assert(overview.currentSessionId === loginA.sessionId, "current session mismatch");
  assert(overview.administrator?.email === adminEmail, "administrator email missing");
  assert(Array.isArray(overview.sessions) && overview.sessions.length >= 2, "active sessions missing");
  assert(overview.sessionPolicy?.sessionDurationHours === 72, "policy missing on overview");

  const others = await adminSecurityService.logoutOtherSessions(admin, fakeReq);
  assert(others.revokedCount >= 1, "logout others failed");

  const recreated = await adminSecurityService.createLoginSession(admin, fakeReq, {
    sessionId: `sess_verify_c_${Date.now()}`,
    deviceFingerprint: "dev_verify_c",
    deviceName: "Verify Device C",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  });

  let rejected = false;
  try {
    await adminSecurityService.logoutAllSessions(admin, fakeReq, { confirmAll: false });
  } catch (error) {
    rejected = Number(error.statusCode) === 400;
  }
  assert(rejected, "logout-all should require confirmation");

  fakeReq.headers["x-admin-session-id"] = recreated.sessionId;
  fakeReq.admin.sid = recreated.sessionId;
  const all = await adminSecurityService.logoutAllSessions(admin, fakeReq, { confirmAll: true });
  assert(all.endedCurrent === true, "logout-all should end current");
  assert(all.revokedCount >= 1, "logout-all revoked none");

  const check = await adminSecurityService.assertSessionAllowed(recreated.sessionId, { touch: false });
  assert(check.allowed === false, "revoked session still allowed");

  await adminSecurityService.updateSessionPolicy({
    sessionDurationHours: beforePolicy.sessionDurationHours,
    idleTimeoutHours: beforePolicy.idleTimeoutHours,
    enforceServerExpiry: beforePolicy.enforceServerExpiry
  }, admin);

  void loginB;
  return { adminId, adminEmail };
}

async function verifyHttp(baseUrl, serviceResult) {
  const { generateToken } = require("../server/utils/token");
  const token = generateToken({
    id: serviceResult.adminId,
    email: serviceResult.adminEmail,
    role: "admin",
    sid: "sess_logout_http"
  });

  const unauth = await request(baseUrl, "GET", "/api/admin/security/sessions/current");
  assert([401, 403].includes(unauth.status), `Expected 401/403, got ${unauth.status}`);

  const current = await request(baseUrl, "GET", "/api/admin/security/sessions/current", {
    token,
    headers: { "X-Admin-Session-Id": "sess_logout_http" }
  });
  assert(current.status === 200 && current.json?.success, `current session failed: ${current.raw}`);

  const policyGet = await request(baseUrl, "GET", "/api/admin/security/sessions/policy", { token });
  assert(policyGet.status === 200 && policyGet.json?.policy, `policy get failed: ${policyGet.raw}`);

  const policyPut = await request(baseUrl, "PUT", "/api/admin/security/sessions/policy", {
    token,
    body: {
      sessionDurationHours: Number(policyGet.json.policy.sessionDurationHours || 168),
      idleTimeoutHours: Number(policyGet.json.policy.idleTimeoutHours || 8),
      enforceServerExpiry: true
    }
  });
  assert(policyPut.status === 200 && policyPut.json?.success, `policy put failed: ${policyPut.raw}`);

  const validate = await request(baseUrl, "GET", "/api/admin/security/sessions/validate", {
    token,
    headers: { "X-Admin-Session-Id": "sess_logout_http" }
  });
  assert(validate.status === 200 && validate.json?.success, `validate failed: ${validate.raw}`);

  const logoutAllReject = await request(baseUrl, "POST", "/api/admin/security/sessions/logout-all", {
    token,
    body: { confirmAll: false }
  });
  assert(logoutAllReject.status === 400, `logout-all without confirm should 400, got ${logoutAllReject.status}`);

  const panels = [
    "admin/app/pages/settings-logout.js",
    "admin/app/pages/settings-profile.js",
    "admin/app/pages/settings-security.js",
    "admin/app/pages/settings-password.js",
    "admin/app/pages/settings-general.js",
    "admin/app/pages/settings-branding.js",
    "admin/app/pages/settings-delivery.js",
    "admin/app/pages/settings-seo.js",
    "admin/app/pages/settings.js"
  ];
  panels.forEach((rel) => {
    assert(fs.existsSync(path.resolve(__dirname, "..", rel)), `${rel} missing`);
  });

  const settingsJs = fs.readFileSync(path.resolve(__dirname, "../admin/app/pages/settings.js"), "utf8");
  assert(settingsJs.includes('activePanel === "logout"'), "settings host missing logout panel");
  assert(settingsJs.includes("renderAdminLogoutPanel"), "settings host missing logout renderer");

  return true;
}

async function main() {
  const baseUrl = String(process.argv[2] || process.env.VERIFY_BASE_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
  console.log(`[verify-admin-logout] baseUrl=${baseUrl}`);

  const serviceResult = await verifyServiceLayer();
  console.log("[verify-admin-logout] service layer OK");

  try {
    await verifyHttp(baseUrl, serviceResult);
    console.log("[verify-admin-logout] HTTP + settings integration OK");
  } catch (error) {
    console.warn(`[verify-admin-logout] HTTP layer skipped/failed: ${error.message}`);
    console.warn("Restart the API server and re-run to verify HTTP endpoints.");
    process.exitCode = 1;
    return;
  }

  console.log("[verify-admin-logout] PASS");
}

main().catch((error) => {
  console.error("[verify-admin-logout] FAIL:", error.message);
  process.exitCode = 1;
});
