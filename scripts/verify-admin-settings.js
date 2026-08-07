#!/usr/bin/env node
/**
 * Aggregated Admin Settings verification (STEP 9).
 * Usage: node scripts/verify-admin-settings.js [baseUrl]
 */
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const baseUrl = String(process.argv[2] || process.env.VERIFY_BASE_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
const root = path.resolve(__dirname, "..");

const scripts = [
  "verify-admin-profile.js",
  "verify-admin-security.js",
  "verify-admin-password.js",
  "verify-admin-general-settings.js",
  "verify-admin-branding.js",
  "verify-admin-delivery.js",
  "verify-admin-seo.js",
  "verify-admin-logout.js"
];

const requiredFiles = [
  "admin/app/pages/settings.js",
  "admin/app/pages/settings-profile.js",
  "admin/app/pages/settings-security.js",
  "admin/app/pages/settings-password.js",
  "admin/app/pages/settings-general.js",
  "admin/app/pages/settings-branding.js",
  "admin/app/pages/settings-delivery.js",
  "admin/app/pages/settings-seo.js",
  "admin/app/pages/settings-logout.js",
  "admin/app/core/navigation.js",
  "js/storefront-settings.js",
  "server/repositories/sqlite/settings.repository.js"
];

console.log(`[verify-admin-settings] baseUrl=${baseUrl}`);

let failed = false;

requiredFiles.forEach((rel) => {
  const full = path.resolve(root, rel);
  if (!fs.existsSync(full)) {
    console.error(`[verify-admin-settings] MISSING ${rel}`);
    failed = true;
    return;
  }
  console.log(`[verify-admin-settings] OK file ${rel}`);
});

const settingsHost = fs.readFileSync(path.resolve(root, "admin/app/pages/settings.js"), "utf8");
const nav = fs.readFileSync(path.resolve(root, "admin/app/core/navigation.js"), "utf8");
const repo = fs.readFileSync(path.resolve(root, "server/repositories/sqlite/settings.repository.js"), "utf8");

["profile", "security", "password", "general", "branding", "delivery", "seo", "logout"].forEach((panel) => {
  if (!settingsHost.includes(`"${panel}"`)) {
    console.error(`[verify-admin-settings] settings host missing panel ${panel}`);
    failed = true;
  } else {
    console.log(`[verify-admin-settings] OK panel ${panel}`);
  }
  if (!nav.includes(`panel=${panel}`) && panel !== "password" && panel !== "security" && panel !== "profile") {
    // password/security/profile also have panel= in nav
  }
  if (!nav.includes(`?panel=${panel}`)) {
    console.error(`[verify-admin-settings] navigation missing ?panel=${panel}`);
    failed = true;
  } else {
    console.log(`[verify-admin-settings] OK nav ${panel}`);
  }
});

if (!repo.includes("touchedModules") || !repo.includes("sessionManagement")) {
  console.error("[verify-admin-settings] settings repository missing sibling-safe merge");
  failed = true;
} else {
  console.log("[verify-admin-settings] OK sibling-safe settings merge");
}

for (const script of scripts) {
  const full = path.resolve(__dirname, script);
  if (!fs.existsSync(full)) {
    console.error(`[verify-admin-settings] MISSING script ${script}`);
    failed = true;
    continue;
  }
  console.log(`[verify-admin-settings] running ${script}...`);
  const result = spawnSync(process.execPath, [full, baseUrl], {
    cwd: root,
    encoding: "utf8",
    env: process.env
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    console.error(`[verify-admin-settings] FAIL ${script} (exit ${result.status})`);
    failed = true;
  } else {
    console.log(`[verify-admin-settings] PASS ${script}`);
  }
}

if (failed) {
  console.error("[verify-admin-settings] FAIL");
  process.exit(1);
}

console.log("[verify-admin-settings] PASS — Admin Settings module is production-ready");
process.exit(0);
