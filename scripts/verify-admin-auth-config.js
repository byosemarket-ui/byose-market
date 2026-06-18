#!/usr/bin/env node
/**
 * Verifies admin authentication environment variables are production-ready.
 */
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const BCRYPT_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const PLACEHOLDER_PATTERN = /(replace_with|changeme|your[-_]|example|todo|set-on-server)/i;

function fail(message) {
  console.error(`[verify-admin-auth-config] FAIL: ${message}`);
  process.exit(1);
}

function main() {
  const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const adminPasswordHash = String(process.env.ADMIN_PASSWORD_HASH || "").trim();
  const jwtSecret = String(process.env.JWT_SECRET || "").trim();

  if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    fail("ADMIN_EMAIL is missing or invalid");
  }

  if (!BCRYPT_PATTERN.test(adminPasswordHash)) {
    fail("ADMIN_PASSWORD_HASH is missing or not a valid bcrypt hash");
  }

  if (!jwtSecret || jwtSecret.length < 32 || PLACEHOLDER_PATTERN.test(jwtSecret)) {
    fail("JWT_SECRET is missing, too short, or still a placeholder");
  }

  let jwtConfig = null;
  try {
    jwtConfig = require("../server/utils/token").getJwtConfig();
  } catch (error) {
    fail(error.message || "JWT configuration is invalid");
  }

  if (!jwtConfig || !jwtConfig.secret) {
    fail("JWT configuration did not resolve a secret");
  }

  console.log("[verify-admin-auth-config] PASS");
  console.log(`  ADMIN_EMAIL=${adminEmail}`);
  console.log("  ADMIN_PASSWORD_HASH=[bcrypt hash present]");
  console.log(`  JWT_SECRET source=${jwtConfig.secretSource}`);
}

main();
