/**
 * Validates VPS production path configuration for uploads and SQLite.
 * Run: node server/scripts/verify-vps-production-config.js
 */
const fs = require("fs");
const path = require("path");
const config = require("../config/env");
const { VPS } = require("../../config/production-targets");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function ensureWritableDir(dirPath, label) {
  assert(fs.existsSync(dirPath), `${label} directory missing: ${dirPath}`);
  fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
}

function main() {
  console.log("[verify-vps-production-config] Checking runtime configuration...");

  ensureWritableDir(config.uploads.rootDir, "Uploads root");
  ensureWritableDir(config.uploads.productsDir, "Products upload bucket");

  const dbDir = path.dirname(config.sqlite.databasePath);
  ensureWritableDir(dbDir, "SQLite directory");

  if (!fs.existsSync(config.sqlite.databasePath)) {
    console.log(`[verify-vps-production-config] SQLite file will be created on first start: ${config.sqlite.databasePath}`);
  } else {
    fs.accessSync(config.sqlite.databasePath, fs.constants.R_OK | fs.constants.W_OK);
  }

  assert(config.uploads.publicMountPath === VPS.publicUploadsPath, "UPLOADS_PUBLIC_PATH must be /uploads");

  if (config.isProduction) {
    const resolvedUploads = path.resolve(config.uploads.rootDir);
    const requiredRoot = path.resolve(VPS.uploadsRoot);

    assert(
      resolvedUploads === requiredRoot,
      `Production UPLOADS_DIR must be exactly ${VPS.uploadsRoot} (got ${resolvedUploads}). Legacy in-repo upload roots are not allowed.`
    );

    assert(
      !resolvedUploads.includes(`${path.sep}server${path.sep}uploads`)
        && !resolvedUploads.endsWith(`${path.sep}server${path.sep}uploads`),
      "Production uploads must live outside the git deploy directory so deploys never wipe images."
    );
  }

  console.log("[verify-vps-production-config] PASS");
  console.log(`  uploads.rootDir: ${config.uploads.rootDir}`);
  console.log(`  sqlite.databasePath: ${config.sqlite.databasePath}`);
  console.log(`  publicMountPath: ${config.uploads.publicMountPath}`);
  console.log(`  corsOrigins: ${(config.corsOrigins || []).join(", ") || "(open in development)"}`);
}

main();
