/**
 * Verify the live PM2 process uses the persistent uploads directory.
 * Run on the VPS after pm2 reload:
 *   UPLOADS_DIR=/var/lib/byosemarket/uploads node scripts/verify-pm2-uploads-path.js
 */
const { execSync } = require("child_process");
const path = require("path");
const { VPS } = require("../config/production-targets");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeDir(value) {
  return path.resolve(String(value || "").trim().replace(/[\\/]+$/, "") || ".");
}

function main() {
  const expected = normalizeDir(process.env.UPLOADS_DIR || VPS.uploadsRoot);
  const appName = String(process.env.PM2_APP_NAME || "byosemarket-api").trim();

  let list;
  try {
    list = JSON.parse(execSync("pm2 jlist", { encoding: "utf8" }));
  } catch (error) {
    throw new Error(`Unable to read PM2 process list: ${error.message}`);
  }

  const app = Array.isArray(list) ? list.find((entry) => entry && entry.name === appName) : null;
  assert(app, `PM2 app not found: ${appName}`);

  const env = app.pm2_env || {};
  const liveUploads = normalizeDir(env.UPLOADS_DIR || env.STORAGE_ROOT || "");
  assert(liveUploads && liveUploads !== path.resolve("."), "PM2 process is missing UPLOADS_DIR/STORAGE_ROOT");
  assert(
    liveUploads === expected,
    `PM2 UPLOADS_DIR mismatch. expected=${expected} live=${liveUploads}`
  );
  assert(
    !/[\\/]server[\\/]uploads$/i.test(liveUploads),
    `Refusing in-repo upload root for production: ${liveUploads}`
  );

  console.log("[verify-pm2-uploads-path] PASS");
  console.log(`  app: ${appName}`);
  console.log(`  uploads: ${liveUploads}`);
}

try {
  main();
} catch (error) {
  console.error("[verify-pm2-uploads-path] FAIL:", error.message);
  process.exit(1);
}
