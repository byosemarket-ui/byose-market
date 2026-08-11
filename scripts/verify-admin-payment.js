#!/usr/bin/env node
/**
 * Verifies Admin Payment Settings (STEP 1 — secure configuration only).
 * Usage: node scripts/verify-admin-payment.js [baseUrl]
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");

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

function assertNoSecretLeak(payload, label) {
  const serialized = JSON.stringify(payload);
  assert(!/"companyToken"\s*:\s*"[^"]{8,}"/.test(serialized), `${label} leaked companyToken value`);
  assert(!serialized.includes("B3F59BE7"), `${label} leaked sample sandbox token`);
  assert(!/"secrets"\s*:\s*\{/.test(serialized), `${label} exposed secrets object`);
}

async function ensureVerifyEncryptionKey() {
  if (String(process.env.PAYMENT_ENCRYPTION_KEY || "").trim()) {
    return "PAYMENT_ENCRYPTION_KEY";
  }

  const jwtSecret = String(process.env.JWT_SECRET || "").trim();
  if (jwtSecret && jwtSecret !== "replace_with_a_long_random_secret") {
    // Match secrets.store fallback so verify and the running API share the same key material.
    return "JWT_SECRET_DERIVED";
  }

  // Ephemeral key for local verify only — never a committed fixed secret.
  process.env.PAYMENT_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
  console.log("[verify-admin-payment] using ephemeral PAYMENT_ENCRYPTION_KEY");
  return "verify_ephemeral";
}

async function verifyServiceLayer() {
  const keySource = await ensureVerifyEncryptionKey();
  console.log(`[verify-admin-payment] encryption key source=${keySource}`);

  const { connectDatabase } = require("../server/database");
  await connectDatabase();

  const paymentSettingsService = require("../server/services/paymentsettings.service");
  const secretsStore = require("../server/payments/secrets.store");
  const registry = require("../server/payments/providers/registry");

  assert(registry.isKnownProvider("dpo"), "DPO provider missing from registry");
  assert(secretsStore.isEncryptionConfigured(), "encryption not configured");

  // If a previous verify run used a different key, reset the encrypted store for this run.
  try {
    secretsStore.readStore();
  } catch (error) {
    if (error?.code === "PAYMENT_CREDENTIALS_DECRYPT_FAILED" || error?.code === "PAYMENT_CREDENTIALS_CORRUPT") {
      const storePath = path.resolve(__dirname, "../server/secure/payment-credentials.enc");
      if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
      console.log("[verify-admin-payment] reset undecryptable payment-credentials.enc");
    } else {
      throw error;
    }
  }

  const initial = await paymentSettingsService.getAdminPaymentSettings();
  assert(initial.activeProvider === "dpo", "default provider should be dpo");
  assert(initial.mode === "test" || initial.mode === "live", "mode missing");
  assert(Array.isArray(initial.providers) && initial.providers.length >= 1, "providers missing");
  assertNoSecretLeak(initial, "initial admin view");

  const fakeToken = `verify-token-${crypto.randomBytes(8).toString("hex")}`;
  const updated = await paymentSettingsService.updatePaymentSettings({
    enabled: false,
    activeProvider: "dpo",
    mode: "test",
    credentials: {
      test: {
        companyToken: fakeToken,
        serviceType: "54841"
      }
    }
  }, { id: "ADMIN_VERIFY", email: "admin@example.com" });

  assert(updated.providers[0].credentials.test.fields.companyToken.configured === true, "company token not marked configured");
  assert(!JSON.stringify(updated).includes(fakeToken), "admin response exposed company token");
  assert(updated.providers[0].credentials.test.fields.companyToken.hint.endsWith(fakeToken.slice(-4)), "hint should show last 4");

  const runtime = await paymentSettingsService.getRuntimePaymentCredentials({ providerId: "dpo", mode: "test" });
  assert(runtime.secrets.companyToken === fakeToken, "runtime secrets should resolve stored token");
  assert(runtime.secrets.serviceType === "54841", "runtime service type missing");

  const publicView = await paymentSettingsService.getPublicPaymentSettings();
  assertNoSecretLeak(publicView, "public payment view");
  assert(!publicView.providers, "public view should not list credential providers");

  // Keep payments disabled after verification (no accidental enable without real merchant creds).
  await paymentSettingsService.updatePaymentSettings({
    enabled: false,
    activeProvider: "dpo",
    mode: "test"
  }, { id: "ADMIN_VERIFY", email: "admin@example.com" });

  const adminEmail = String(process.env.ADMIN_EMAIL || "admin@example.com").trim().toLowerCase();
  const adminId = `ADMIN_${Buffer.from(adminEmail).toString("hex").slice(0, 16)}`;
  return { adminId, adminEmail, fakeToken };
}

async function verifyHttp(baseUrl, serviceResult) {
  const { generateToken } = require("../server/utils/token");
  const token = generateToken({
    id: serviceResult.adminId,
    email: serviceResult.adminEmail,
    role: "admin",
    sid: "sess_payment_http"
  });

  const unauth = await request(baseUrl, "GET", "/api/admin/payment");
  assert([401, 403].includes(unauth.status), `Expected 401/403, got ${unauth.status}`);

  const getRes = await request(baseUrl, "GET", "/api/admin/payment", { token });
  assert(getRes.status === 200 && getRes.json?.success, `get payment failed: ${getRes.raw}`);
  assertNoSecretLeak(getRes.json, "GET /api/admin/payment");
  assert(!String(getRes.raw).includes(serviceResult.fakeToken), "HTTP GET leaked verify token");

  const putRes = await request(baseUrl, "PUT", "/api/admin/payment", {
    token,
    body: {
      enabled: false,
      activeProvider: "dpo",
      mode: "test",
      credentials: {
        test: {
          companyToken: `http-${serviceResult.fakeToken}`,
          serviceType: "54841"
        }
      }
    }
  });
  assert(putRes.status === 200 && putRes.json?.success, `put payment failed: ${putRes.raw}`);
  assertNoSecretLeak(putRes.json, "PUT /api/admin/payment");
  assert(!String(putRes.raw).includes(`http-${serviceResult.fakeToken}`), "HTTP PUT leaked company token");

  return true;
}

async function verifyHttpInProcess(serviceResult) {
  const express = require("express");
  const createApiRouter = require("../server/api");

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", createApiRouter());

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.on("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    await verifyHttp(baseUrl, serviceResult);
    return true;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const externalBaseUrl = process.argv[2] || process.env.VERIFY_BASE_URL || "";
  console.log(`[verify-admin-payment] mode=${externalBaseUrl ? "external" : "in-process"}`);

  [
    "admin/app/pages/settings-payment.js",
    "admin/app/core/navigation.js",
    "server/services/paymentsettings.service.js",
    "server/payments/secrets.store.js",
    "server/payments/providers/dpo.provider.js",
    "server/payments/providers/registry.js",
    "server/routes/adminpayment.js",
    "server/controllers/adminpaymentcontroller.js"
  ].forEach((rel) => {
    assert(fs.existsSync(path.resolve(__dirname, "..", rel)), `${rel} missing`);
  });

  const navigationSource = fs.readFileSync(path.resolve(__dirname, "../admin/app/core/navigation.js"), "utf8");
  assert(navigationSource.includes("website-payment-management"), "Website Management missing Payment Management nav item");
  assert(navigationSource.includes("?panel=payment"), "Payment nav must open settings?panel=payment");
  assert(!/companyToken\s*[:=]\s*["'][^"']{8,}/.test(navigationSource), "navigation must not hardcode company tokens");

  const gitignore = fs.readFileSync(path.resolve(__dirname, "../.gitignore"), "utf8");
  assert(gitignore.includes(".env"), ".gitignore must exclude .env");
  assert(gitignore.includes("server/secure/") || gitignore.includes("*.enc"), ".gitignore must exclude payment secret store");

  const serviceResult = await verifyServiceLayer();
  console.log("[verify-admin-payment] service layer OK");

  try {
    if (externalBaseUrl) {
      await verifyHttp(String(externalBaseUrl).replace(/\/+$/, ""), serviceResult);
    } else {
      await verifyHttpInProcess(serviceResult);
    }
    console.log("[verify-admin-payment] HTTP layer OK");
  } catch (error) {
    console.error(`[verify-admin-payment] HTTP layer failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  console.log("[verify-admin-payment] PASS");
}

main().catch((error) => {
  console.error("[verify-admin-payment] FAIL:", error.message);
  process.exitCode = 1;
});
