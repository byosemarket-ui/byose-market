#!/usr/bin/env node
/**
 * Verifies Admin Branding module (service, DB nesting, APIs).
 * Usage: node scripts/verify-admin-branding.js [baseUrl]
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

  const brandingSettingsService = require("../server/services/brandingsettings.service");
  const generalSettingsService = require("../server/services/generalsettings.service");

  const before = await brandingSettingsService.getAdminBranding();
  assert(before.colors?.primary, "primary color missing");
  assert(before.identity?.tagline, "tagline missing");

  const marker = `Brand tagline ${Date.now().toString().slice(-5)}`;
  const updated = await brandingSettingsService.updateBranding({
    colors: { ...before.colors, primary: "#112233" },
    identity: {
      tagline: marker,
      slogan: before.identity.slogan,
      brandDescription: before.identity.brandDescription,
      copyrightText: before.identity.copyrightText,
      footerCopyright: before.identity.footerCopyright,
      businessRegistrationNumber: before.identity.businessRegistrationNumber,
      vatNumber: before.identity.vatNumber
    }
  }, { id: "ADMIN_VERIFY", email: "admin@example.com" });

  assert(updated.colors.primary === "#112233", "primary color not saved");
  assert(updated.identity.tagline === marker, "tagline not saved");

  // Ensure general settings still intact / branding nested.
  const general = await generalSettingsService.getGeneralSettings();
  assert(general.storeName, "general settings wiped");

  const publicSettings = await generalSettingsService.getPublicSettings();
  assert(publicSettings.branding?.colors?.primary === "#112233", "public branding missing primary");
  assert(publicSettings.branding?.identity?.tagline === marker, "public branding tagline mismatch");

  let rejected = false;
  try {
    await brandingSettingsService.updateBranding({ colors: { primary: "not-a-color" } }, { id: "ADMIN_VERIFY", email: "admin@example.com" });
  } catch (error) {
    rejected = Number(error.statusCode) === 400;
  }
  assert(rejected, "invalid color should be rejected");

  // Restore colors roughly.
  await brandingSettingsService.updateBranding({
    colors: before.colors,
    identity: {
      tagline: before.identity.tagline,
      slogan: before.identity.slogan,
      brandDescription: before.identity.brandDescription,
      copyrightText: before.identity.copyrightText,
      footerCopyright: before.identity.footerCopyright,
      businessRegistrationNumber: before.identity.businessRegistrationNumber,
      vatNumber: before.identity.vatNumber
    }
  }, { id: "ADMIN_VERIFY", email: "admin@example.com" });

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
    sid: "sess_branding_http"
  });

  const unauth = await request(baseUrl, "GET", "/api/admin/branding");
  assert([401, 403].includes(unauth.status), `Expected 401/403, got ${unauth.status}`);

  const getRes = await request(baseUrl, "GET", "/api/admin/branding", { token });
  assert(getRes.status === 200 && getRes.json?.success, `get branding failed: ${getRes.raw}`);
  assert(getRes.json.branding?.colors, "branding colors missing");

  const putMarker = `HTTP Brand ${Date.now().toString().slice(-4)}`;
  const putRes = await request(baseUrl, "PUT", "/api/admin/branding", {
    token,
    body: {
      identity: {
        ...(getRes.json.branding.identity || {}),
        tagline: putMarker
      },
      colors: getRes.json.branding.colors
    }
  });
  assert(putRes.status === 200 && putRes.json?.success, `put branding failed: ${putRes.raw}`);
  assert(putRes.json.branding?.identity?.tagline === putMarker, "HTTP put tagline mismatch");

  const publicRes = await request(baseUrl, "GET", "/api/settings/public");
  assert(publicRes.status === 200 && publicRes.json?.settings?.branding?.identity?.tagline === putMarker, "public branding not updated");

  const health = await request(baseUrl, "GET", "/api/uploads/health", { token });
  assert(health.status === 200, `uploads health failed: ${health.raw}`);
  const buckets = (health.json?.uploads?.buckets || []).map((b) => b.key);
  assert(buckets.includes("branding"), "branding upload bucket missing");

  // Restore
  await request(baseUrl, "PUT", "/api/admin/branding", {
    token,
    body: {
      identity: getRes.json.branding.identity,
      colors: getRes.json.branding.colors
    }
  });

  return true;
}

async function main() {
  const baseUrl = String(process.argv[2] || process.env.VERIFY_BASE_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
  console.log(`[verify-admin-branding] baseUrl=${baseUrl}`);

  const serviceResult = await verifyServiceLayer();
  console.log("[verify-admin-branding] service layer OK");

  const uiFiles = [
    "admin/app/pages/settings-branding.js",
    "admin/app/pages/settings.js",
    "server/services/brandingsettings.service.js",
    "js/storefront-settings.js"
  ];
  uiFiles.forEach((rel) => {
    assert(fs.existsSync(path.resolve(__dirname, "..", rel)), `${rel} missing`);
  });

  try {
    await verifyHttp(baseUrl, serviceResult);
    console.log("[verify-admin-branding] HTTP layer OK");
  } catch (error) {
    console.warn(`[verify-admin-branding] HTTP layer skipped/failed: ${error.message}`);
    console.warn("Restart the API server and re-run to verify HTTP endpoints.");
    process.exitCode = 1;
    return;
  }

  console.log("[verify-admin-branding] PASS");
}

main().catch((error) => {
  console.error("[verify-admin-branding] FAIL:", error.message);
  process.exitCode = 1;
});
