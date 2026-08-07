#!/usr/bin/env node
/**
 * Verifies Admin General Settings module (service, DB, APIs, public settings).
 * Usage: node scripts/verify-admin-general-settings.js [baseUrl]
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

  const { getClient } = require("../server/database/sqlite/client");
  const db = getClient();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  assert(tables.includes("settings"), "settings table missing");

  const cols = db.prepare("PRAGMA table_info(settings)").all().map((row) => row.name);
  ["key", "store_name", "support_email", "support_phone", "currency", "value_json"].forEach((col) => {
    assert(cols.includes(col), `settings.${col} missing`);
  });

  const generalSettingsService = require("../server/services/generalsettings.service");
  const loaded = await generalSettingsService.getGeneralSettings();
  assert(loaded.storeName, "storeName missing from general settings");
  assert(loaded.notifications && typeof loaded.notifications === "object", "notifications missing");
  assert(typeof loaded.allowGuestCheckout === "boolean", "allowGuestCheckout missing");

  const marker = `Verify Store ${Date.now().toString().slice(-6)}`;
  const updated = await generalSettingsService.updateGeneralSettings({
    storeName: marker,
    companyName: "BYOSE Market Verify Ltd",
    supportEmail: "verify-support@byosemarket.com",
    currency: "RWF",
    currencySymbol: "RWF",
    language: "en",
    storeStatus: "open",
    maintenanceMode: false,
    allowCustomerRegistration: true,
    allowGuestCheckout: true,
    notifications: {
      emailNotifications: true,
      orderNotifications: true,
      customerRegistrationNotifications: false,
      contactFormNotifications: true,
      lowStockNotifications: true,
      systemNotifications: true
    }
  }, { id: "ADMIN_VERIFY", email: "admin@example.com" });

  assert(updated.storeName === marker, "update did not persist storeName");
  assert(updated.notifications.customerRegistrationNotifications === false, "notification preference not saved");

  const publicSettings = await generalSettingsService.getPublicSettings();
  assert(publicSettings.storeName === marker, "public settings storeName mismatch");
  assert(publicSettings.notifications == null, "public settings must not expose private notification prefs");

  let rejected = false;
  try {
    await generalSettingsService.updateGeneralSettings({ currency: "BTC" }, { id: "ADMIN_VERIFY", email: "admin@example.com" });
  } catch (error) {
    rejected = Number(error.statusCode) === 400;
  }
  assert(rejected, "invalid currency should be rejected");

  await generalSettingsService.updateGeneralSettings({
    storeName: loaded.storeName,
    companyName: loaded.companyName,
    supportEmail: loaded.supportEmail,
    notifications: loaded.notifications
  }, { id: "ADMIN_VERIFY", email: "admin@example.com" });

  const adminEmail = String(process.env.ADMIN_EMAIL || "admin@example.com").trim().toLowerCase();
  const adminId = `ADMIN_${Buffer.from(adminEmail).toString("hex").slice(0, 16)}`;
  return { adminId, adminEmail, marker };
}

async function verifyHttp(baseUrl, serviceResult) {
  const { generateToken } = require("../server/utils/token");
  const token = generateToken({
    id: serviceResult.adminId,
    email: serviceResult.adminEmail,
    role: "admin",
    sid: "sess_general_settings_http"
  });

  const unauth = await request(baseUrl, "GET", "/api/admin/settings");
  assert([401, 403].includes(unauth.status), `Expected 401/403 for admin settings, got ${unauth.status}`);

  const publicRes = await request(baseUrl, "GET", "/api/settings/public");
  assert(publicRes.status === 200 && publicRes.json?.success, `public settings failed: ${publicRes.raw}`);
  assert(publicRes.json.settings?.storeName, "public settings missing storeName");
  assert(publicRes.json.settings?.currency, "public settings missing currency");

  const getRes = await request(baseUrl, "GET", "/api/admin/settings", { token });
  assert(getRes.status === 200 && getRes.json?.success, `admin get settings failed: ${getRes.raw}`);
  assert(getRes.json.settings?.notifications, "admin settings missing notifications");

  const putMarker = `HTTP Store ${Date.now().toString().slice(-5)}`;
  const putRes = await request(baseUrl, "PUT", "/api/admin/settings", {
    token,
    body: {
      storeName: putMarker,
      supportEmail: getRes.json.settings.supportEmail || "byosemarket@gmail.com",
      currency: "RWF",
      language: "en",
      storeStatus: "open",
      allowGuestCheckout: true,
      allowCustomerRegistration: true,
      notifications: {
        ...(getRes.json.settings.notifications || {}),
        systemNotifications: true
      }
    }
  });
  assert(putRes.status === 200 && putRes.json?.success, `admin put settings failed: ${putRes.raw}`);
  assert(putRes.json.settings?.storeName === putMarker, "HTTP put did not return updated storeName");

  const publicAfter = await request(baseUrl, "GET", "/api/settings/public");
  assert(publicAfter.json?.settings?.storeName === putMarker, "public settings did not reflect admin update");

  // Restore prior store name for cleanliness.
  await request(baseUrl, "PUT", "/api/admin/settings", {
    token,
    body: {
      ...getRes.json.settings,
      storeName: getRes.json.settings.storeName
    }
  });

  return true;
}

async function main() {
  const baseUrl = String(process.argv[2] || process.env.VERIFY_BASE_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
  console.log(`[verify-admin-general-settings] baseUrl=${baseUrl}`);

  const serviceResult = await verifyServiceLayer();
  console.log("[verify-admin-general-settings] service layer OK");

  try {
    await verifyHttp(baseUrl, serviceResult);
    console.log("[verify-admin-general-settings] HTTP layer OK");
  } catch (error) {
    console.warn(`[verify-admin-general-settings] HTTP layer skipped/failed: ${error.message}`);
    console.warn("Start the API server and re-run to verify HTTP endpoints.");
    process.exitCode = 1;
    return;
  }

  const uiFiles = [
    "admin/app/pages/settings-general.js",
    "admin/app/pages/settings.js",
    "js/storefront-settings.js"
  ];
  uiFiles.forEach((rel) => {
    assert(fs.existsSync(path.resolve(__dirname, "..", rel)), `${rel} missing`);
  });

  console.log("[verify-admin-general-settings] PASS");
}

main().catch((error) => {
  console.error("[verify-admin-general-settings] FAIL:", error.message);
  process.exitCode = 1;
});
