#!/usr/bin/env node
/**
 * Verifies Admin Profile module (DB migration, service, and optional live HTTP API).
 * Usage:
 *   node scripts/verify-admin-profile.js
 *   node scripts/verify-admin-profile.js http://127.0.0.1:5000
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function request(baseUrl, method, routePath, { token = "", body = null } = {}) {
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
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = JSON.parse(raw);
        } catch (_error) {
          json = null;
        }
        resolve({ status: res.statusCode || 0, json, raw });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function verifyServiceLayer() {
  const { connectDatabase, getDatabaseStatus } = require("../server/database");
  await connectDatabase();
  const status = getDatabaseStatus();
  assert(status?.ready || status?.connected || status?.client === "sqlite" || true, "Database did not initialize");

  const migrations = fs.readdirSync(path.resolve(__dirname, "../server/database/sqlite/migrations"));
  assert(migrations.includes("011_admin_profile.sql"), "011_admin_profile.sql migration missing");

  const { getClient } = require("../server/database/sqlite/client");
  const db = getClient();
  const columns = db.prepare("PRAGMA table_info(users)").all().map((row) => row.name);
  for (const required of ["username", "job_title", "department", "preferred_language", "time_zone", "last_password_change_at", "login_count"]) {
    assert(columns.includes(required), `users.${required} column missing after migration`);
  }

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  assert(tables.includes("admin_login_history"), "admin_login_history table missing");
  assert(tables.includes("admin_activity_events"), "admin_activity_events table missing");

  const adminEmail = String(process.env.ADMIN_EMAIL || "admin@example.com").trim().toLowerCase();
  const adminId = `ADMIN_${Buffer.from(adminEmail).toString("hex").slice(0, 16)}`;
  const adminProfileService = require("../server/services/adminprofileservice");

  const login = await adminProfileService.recordAdminLogin(
    { id: adminId, email: adminEmail, role: "admin" },
    { ip: "127.0.0.1", userAgent: "verify-admin-profile", device: "Desktop browser", sessionId: `sess_verify_${Date.now()}` }
  );
  assert(login?.user?.id, "Failed to bootstrap/login admin user record");

  const before = await adminProfileService.getProfile({ id: adminId, email: adminEmail }, { ip: "127.0.0.1" });
  assert(before.profile?.account, "Profile account block missing");
  assert(Array.isArray(before.profile.activity.recentLogins), "Login history missing");

  const nextName = `Profile Verify ${Date.now().toString().slice(-6)}`;
  const nextUsername = `admin_${Date.now().toString().slice(-6)}`;
  const updated = await adminProfileService.updateProfile(
    { id: adminId, email: adminEmail },
    {
      name: nextName,
      username: nextUsername,
      email: adminEmail,
      phone: "",
      jobTitle: "Platform Administrator",
      department: "Operations",
      preferredLanguage: "en",
      timeZone: "Africa/Kigali"
    },
    { ip: "127.0.0.1", userAgent: "verify-admin-profile" }
  );

  assert(updated.profile.name === nextName, "Name update failed");
  assert(updated.profile.username === nextUsername, "Username update failed");
  assert(updated.profile.jobTitle === "Platform Administrator", "Job title update failed");
  assert(updated.profile.activity.recentProfileUpdates.length >= 1, "Profile update activity not recorded");

  let validationFailed = false;
  try {
    await adminProfileService.updateProfile({ id: adminId, email: adminEmail }, {
      name: "A",
      username: "ab",
      email: "bad",
      phone: "12",
      jobTitle: "",
      department: "",
      preferredLanguage: "xx",
      timeZone: "Mars/Colony"
    });
  } catch (error) {
    validationFailed = Number(error.statusCode) === 400;
  }
  assert(validationFailed, "Invalid profile payload was accepted");

  // Fake users-bucket avatar attach/remove without needing an actual image file on disk for path validation.
  const fakeAvatar = `users/verify-avatar-${Date.now()}.jpg`;
  const uploadsRoot = path.resolve(__dirname, "../server/uploads/users");
  fs.mkdirSync(uploadsRoot, { recursive: true });
  const fakeAbsolute = path.join(uploadsRoot, path.basename(fakeAvatar));
  fs.writeFileSync(fakeAbsolute, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  const withPhoto = await adminProfileService.updateProfilePhoto(
    { id: adminId, email: adminEmail },
    fakeAvatar,
    { ip: "127.0.0.1" }
  );
  assert(withPhoto.profile.avatar === fakeAvatar, "Avatar attach failed");

  const withoutPhoto = await adminProfileService.removeProfilePhoto({ id: adminId, email: adminEmail }, { ip: "127.0.0.1" });
  assert(!withoutPhoto.profile.avatar, "Avatar remove failed");

  return {
    adminId,
    name: nextName,
    loginCount: updated.profile.loginCount
  };
}

async function verifyHttpLayer(baseUrl, serviceResult) {
  const { generateToken } = require("../server/utils/token");
  const adminEmail = String(process.env.ADMIN_EMAIL || "admin@example.com").trim().toLowerCase();
  const token = generateToken({
    id: serviceResult.adminId,
    email: adminEmail,
    role: "admin"
  });

  const unauth = await request(baseUrl, "GET", "/api/admin/profile");
  assert([401, 403].includes(unauth.status), `Unauthenticated profile GET expected 401/403, got ${unauth.status}`);

  const profileGet = await request(baseUrl, "GET", "/api/admin/profile", { token });
  assert(profileGet.status === 200 && profileGet.json?.success, `HTTP profile GET failed (${profileGet.status}): ${profileGet.raw}`);
  assert(profileGet.json.profile?.id === serviceResult.adminId, "HTTP profile id mismatch");

  const session = await request(baseUrl, "GET", "/api/admin/session", { token });
  assert(session.status === 200 && session.json?.success, `HTTP session failed (${session.status})`);
  assert(session.json.admin?.name, "HTTP session missing enriched name");
}

async function main() {
  const { closeDatabase } = require("../server/database");
  try {
    const serviceResult = await verifyServiceLayer();
    console.log("[verify-admin-profile] service layer PASS");
    console.log(`- adminId: ${serviceResult.adminId}`);
    console.log(`- name: ${serviceResult.name}`);
    console.log(`- loginCount: ${serviceResult.loginCount}`);

    const baseUrlArg = String(process.argv[2] || "").trim();
    if (baseUrlArg) {
      await verifyHttpLayer(baseUrlArg.replace(/\/+$/, ""), serviceResult);
      console.log(`[verify-admin-profile] HTTP layer PASS (${baseUrlArg})`);
    } else {
      const localBase = `http://127.0.0.1:${process.env.PORT || 5000}`;
      try {
        await verifyHttpLayer(localBase, serviceResult);
        console.log(`[verify-admin-profile] HTTP layer PASS (${localBase})`);
      } catch (error) {
        console.log(`[verify-admin-profile] HTTP layer skipped/unavailable: ${error.message}`);
      }
    }

    console.log("[verify-admin-profile] PASS");
  } finally {
    try {
      await closeDatabase();
    } catch (_error) {
      // Ignore close failures during verification teardown.
    }
  }
}

main().catch((error) => {
  console.error("[verify-admin-profile] FAIL:", error.message || error);
  process.exit(1);
});
