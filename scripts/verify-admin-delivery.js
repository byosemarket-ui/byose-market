#!/usr/bin/env node
/**
 * Verifies Admin Delivery Settings module.
 * Usage: node scripts/verify-admin-delivery.js [baseUrl]
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
  assert(migrations.includes("014_delivery_settings.sql"), "014_delivery_settings.sql missing");

  const { getClient } = require("../server/database/sqlite/client");
  const db = getClient();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  assert(tables.includes("delivery_zones"), "delivery_zones table missing");

  const deliverySettingsService = require("../server/services/deliverysettings.service");
  const admin = await deliverySettingsService.getAdminDeliverySettings();
  assert(admin.config?.pricing, "pricing config missing");
  assert(Array.isArray(admin.zones), "zones missing");
  assert(admin.zones.length >= 1, "expected seeded zones");

  const quoteKigali = await deliverySettingsService.calculateShipping({
    subtotal: 10000,
    address: { country: "Rwanda", provinceCity: "Kigali" },
    method: "homeDelivery"
  });
  assert(Number.isFinite(quoteKigali.fee), "quote fee missing");
  assert(quoteKigali.method === "homeDelivery", "method mismatch");

  const pickup = await deliverySettingsService.calculateShipping({
    subtotal: 10000,
    address: { country: "Rwanda", provinceCity: "Kigali" },
    method: "storePickup"
  });
  assert(pickup.fee === 0, "store pickup should be free");

  const updated = await deliverySettingsService.updateDeliveryConfig({
    pricing: {
      ...admin.config.pricing,
      freeDeliveryThreshold: 50000,
      fixedFee: 2000,
      mode: "zone"
    }
  }, { id: "ADMIN_VERIFY", email: "admin@example.com" });
  assert(updated.pricing.freeDeliveryThreshold === 50000, "threshold not saved");

  const freeQuote = await deliverySettingsService.calculateShipping({
    subtotal: 60000,
    address: { country: "Rwanda", provinceCity: "Kigali" },
    method: "homeDelivery"
  });
  assert(freeQuote.fee === 0 && freeQuote.freeDeliveryApplied, "free delivery threshold failed");

  await deliverySettingsService.updateDeliveryConfig({
    pricing: admin.config.pricing,
    methods: admin.config.methods,
    timing: admin.config.timing
  }, { id: "ADMIN_VERIFY", email: "admin@example.com" });

  const publicDelivery = await deliverySettingsService.getPublicDeliverySettings();
  assert(publicDelivery.methods?.length, "public methods missing");

  const general = await require("../server/services/generalsettings.service").getPublicSettings();
  assert(general.delivery?.pricing, "public settings missing delivery");

  const adminEmail = String(process.env.ADMIN_EMAIL || "admin@example.com").trim().toLowerCase();
  const adminId = `ADMIN_${Buffer.from(adminEmail).toString("hex").slice(0, 16)}`;
  return { adminId, adminEmail };
}

async function verifyHttp(baseUrl, serviceResult) {
  const { generateToken } = require("../server/utils/token");
  const token = generateToken({
    id: serviceResult.adminId,
    email: serviceResult.adminEmail,
    role: "admin",
    sid: "sess_delivery_http"
  });

  const unauth = await request(baseUrl, "GET", "/api/admin/delivery");
  assert([401, 403].includes(unauth.status), `Expected 401/403, got ${unauth.status}`);

  const getRes = await request(baseUrl, "GET", "/api/admin/delivery", { token });
  assert(getRes.status === 200 && getRes.json?.success, `get delivery failed: ${getRes.raw}`);

  const methods = await request(baseUrl, "GET", "/api/shipping/methods");
  assert(methods.status === 200 && methods.json?.delivery, `public methods failed: ${methods.raw}`);

  const calc = await request(baseUrl, "POST", "/api/shipping/calculate", {
    body: {
      subtotal: 12000,
      method: "homeDelivery",
      address: { country: "Rwanda", provinceCity: "Kigali", district: "Gasabo" }
    }
  });
  assert(calc.status === 200 && calc.json?.shipping, `calculate failed: ${calc.raw}`);
  assert(Number.isFinite(calc.json.shipping.fee), "calculate fee missing");

  const zoneName = `Verify Zone ${Date.now().toString().slice(-4)}`;
  const created = await request(baseUrl, "POST", "/api/admin/delivery/zones", {
    token,
    body: {
      name: zoneName,
      country: "Rwanda",
      provinceCity: "Musanze",
      fee: 4000,
      enabled: true
    }
  });
  assert(created.status === 201 && created.json?.zone?.publicId, `create zone failed: ${created.raw}`);

  const zoneId = created.json.zone.publicId;
  const updated = await request(baseUrl, "PUT", `/api/admin/delivery/zones/${zoneId}`, {
    token,
    body: { enabled: false, fee: 4500 }
  });
  assert(updated.status === 200 && updated.json?.zone?.enabled === false, `update zone failed: ${updated.raw}`);

  const removed = await request(baseUrl, "DELETE", `/api/admin/delivery/zones/${zoneId}`, { token });
  assert(removed.status === 200 && removed.json?.success, `delete zone failed: ${removed.raw}`);

  return true;
}

async function main() {
  const baseUrl = String(process.argv[2] || process.env.VERIFY_BASE_URL || "http://127.0.0.1:5010").replace(/\/+$/, "");
  console.log(`[verify-admin-delivery] baseUrl=${baseUrl}`);

  const serviceResult = await verifyServiceLayer();
  console.log("[verify-admin-delivery] service layer OK");

  [
    "admin/app/pages/settings-delivery.js",
    "server/services/deliverysettings.service.js",
    "orders/shipping-api.js"
  ].forEach((rel) => {
    assert(fs.existsSync(path.resolve(__dirname, "..", rel)), `${rel} missing`);
  });

  try {
    await verifyHttp(baseUrl, serviceResult);
    console.log("[verify-admin-delivery] HTTP layer OK");
  } catch (error) {
    console.warn(`[verify-admin-delivery] HTTP layer skipped/failed: ${error.message}`);
    console.warn("Restart the API server and re-run to verify HTTP endpoints.");
    process.exitCode = 1;
    return;
  }

  console.log("[verify-admin-delivery] PASS");
}

main().catch((error) => {
  console.error("[verify-admin-delivery] FAIL:", error.message);
  process.exitCode = 1;
});
