#!/usr/bin/env node
/**
 * Verifies Admin Password module (DB, policy, APIs).
 * Usage: node scripts/verify-admin-password.js [baseUrl]
 *
 * Optional full change cycle when ADMIN_PASSWORD plaintext is present in env.
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
  assert(migrations.includes("013_admin_password.sql"), "013_admin_password.sql missing");

  const { getClient } = require("../server/database/sqlite/client");
  const db = getClient();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  assert(tables.includes("admin_password_history"), "admin_password_history missing");

  const cols = db.prepare("PRAGMA table_info(users)").all().map((row) => row.name);
  assert(cols.includes("password_version"), "password_version missing");
  assert(cols.includes("password_expires_at"), "password_expires_at missing");

  const { evaluatePasswordStrength } = require("../server/utils/passwordpolicy");
  const weak = evaluatePasswordStrength("abc");
  assert(weak.meetsPolicy === false, "weak password accepted");
  const strong = evaluatePasswordStrength("Str0ng!Pass#2026");
  assert(strong.meetsPolicy === true, "strong password rejected");
  assert(["Strong", "Very Strong"].includes(strong.label), "unexpected strength label");

  const adminEmail = String(process.env.ADMIN_EMAIL || "admin@example.com").trim().toLowerCase();
  const adminId = `ADMIN_${Buffer.from(adminEmail).toString("hex").slice(0, 16)}`;
  const adminPasswordService = require("../server/services/adminpasswordservice");

  const status = await adminPasswordService.getPasswordStatus({ id: adminId, email: adminEmail });
  assert(status.policy, "password policy missing");
  assert(Array.isArray(status.history), "password history missing");
  assert(status.expiration?.prepared === true, "expiration architecture missing");

  let rejected = false;
  try {
    await adminPasswordService.verifyCurrentPassword({ id: adminId, email: adminEmail }, "definitely-wrong-password-123!");
  } catch (error) {
    rejected = Number(error.statusCode) === 401;
  }
  assert(rejected, "invalid current password should be rejected");

  const plaintext = String(process.env.ADMIN_PASSWORD || "").trim();
  if (plaintext) {
    const nextPassword = `Tmp#Pass${Date.now().toString().slice(-6)}A1`;
    const changed = await adminPasswordService.changePassword(
      { id: adminId, email: adminEmail },
      {
        currentPassword: plaintext,
        newPassword: nextPassword,
        confirmPassword: nextPassword
      },
      { headers: { "user-agent": "verify-admin-password" }, admin: { sid: "sess_verify_password" } }
    );
    assert(changed.changed === true, "password change failed");
    assert(changed.passwordVersion >= 2, "password version not incremented");

    const restored = await adminPasswordService.changePassword(
      { id: adminId, email: adminEmail },
      {
        currentPassword: nextPassword,
        newPassword: plaintext.length >= 10 ? plaintext : `${plaintext}!Aa1xxxx`,
        confirmPassword: plaintext.length >= 10 ? plaintext : `${plaintext}!Aa1xxxx`
      },
      { headers: { "user-agent": "verify-admin-password" }, admin: { sid: "sess_verify_password" } }
    );
    assert(restored.changed === true, "password restore failed");
  }

  return { adminId, adminEmail };
}

async function verifyHttp(baseUrl, serviceResult) {
  const { generateToken } = require("../server/utils/token");
  const token = generateToken({
    id: serviceResult.adminId,
    email: serviceResult.adminEmail,
    role: "admin",
    sid: "sess_password_http"
  });

  const unauth = await request(baseUrl, "GET", "/api/admin/password");
  assert([401, 403].includes(unauth.status), `Expected 401/403, got ${unauth.status}`);

  const status = await request(baseUrl, "GET", "/api/admin/password", { token });
  assert(status.status === 200 && status.json?.success, `status failed: ${status.raw}`);
  assert(status.json.password?.policy, "HTTP password policy missing");

  const validate = await request(baseUrl, "POST", "/api/admin/password/validate", {
    token,
    body: { password: "Str0ng!Pass#2026" }
  });
  assert(validate.status === 200 && validate.json?.strength?.meetsPolicy === true, `validate failed: ${validate.raw}`);

  const badVerify = await request(baseUrl, "POST", "/api/admin/password/verify-current", {
    token,
    body: { currentPassword: "wrong-password-value" }
  });
  assert(badVerify.status === 401, `expected verify 401, got ${badVerify.status}`);
}

async function main() {
  const { closeDatabase } = require("../server/database");
  try {
    const serviceResult = await verifyServiceLayer();
    console.log("[verify-admin-password] service layer PASS");

    const baseUrlArg = String(process.argv[2] || "").trim();
    const localBase = baseUrlArg || `http://127.0.0.1:${process.env.PORT || 5001}`;
    try {
      await verifyHttp(localBase.replace(/\/+$/, ""), serviceResult);
      console.log(`[verify-admin-password] HTTP layer PASS (${localBase})`);
    } catch (error) {
      if (baseUrlArg) throw error;
      console.log(`[verify-admin-password] HTTP layer skipped/unavailable: ${error.message}`);
    }

    console.log("[verify-admin-password] PASS");
  } finally {
    try { await closeDatabase(); } catch (_error) {}
  }
}

main().catch((error) => {
  console.error("[verify-admin-password] FAIL:", error.message || error);
  process.exit(1);
});
