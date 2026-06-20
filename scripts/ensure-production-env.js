#!/usr/bin/env node
/**
 * Ensures production auth environment variables exist in .env without overwriting
 * valid secrets during GitHub auto-deploy (git reset does not remove .env).
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { VPS } = require("../config/production-targets");

const projectRoot = path.resolve(__dirname, "..");
const envPath = path.join(projectRoot, ".env");
const examplePath = path.join(projectRoot, ".env.example");
const productionExamplePath = path.join(projectRoot, "deploy", "env.production.example");

const ADMIN_EMAIL = "byosemarket@gmail.com";
const ADMIN_PASSWORD_HASH = "$2a$12$Dc49UND0Ir17UQ4VdU1Xc.N1ZG32g8GceMpGYYOhhgjtlBUhGAeea";
const PLACEHOLDER_PATTERN = /(replace_with|changeme|your[-_]|example|todo|set-on-server)/i;
const BCRYPT_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

function log(message) {
  console.log(`[ensure-production-env] ${message}`);
}

function isPlaceholder(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return true;
  }

  return PLACEHOLDER_PATTERN.test(normalized);
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return new Map();
  }

  const entries = new Map();
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    entries.set(key, value);
  }

  return entries;
}

function serializeEnvFile(entries, sourceLines) {
  const knownKeys = new Set(entries.keys());
  const output = [];
  const consumed = new Set();

  if (Array.isArray(sourceLines)) {
    for (const line of sourceLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        output.push(line);
        continue;
      }

      const key = trimmed.slice(0, trimmed.indexOf("=")).trim();
      if (!entries.has(key)) {
        output.push(line);
        continue;
      }

      output.push(`${key}=${entries.get(key)}`);
      consumed.add(key);
    }
  }

  for (const [key, value] of entries.entries()) {
    if (!consumed.has(key)) {
      output.push(`${key}=${value}`);
    }
  }

  return `${output.join("\n").replace(/\n+$/, "")}\n`;
}

function chooseTemplatePath() {
  if (fs.existsSync(productionExamplePath)) {
    return productionExamplePath;
  }

  return examplePath;
}

function ensureAuthValues(entries) {
  let changed = false;

  if (isPlaceholder(entries.get("ADMIN_EMAIL"))) {
    entries.set("ADMIN_EMAIL", ADMIN_EMAIL);
    changed = true;
  }

  const currentHash = String(entries.get("ADMIN_PASSWORD_HASH") || "").trim();
  if (!BCRYPT_PATTERN.test(currentHash)) {
    entries.set("ADMIN_PASSWORD_HASH", ADMIN_PASSWORD_HASH);
    changed = true;
  }

  const currentJwt = String(entries.get("JWT_SECRET") || "").trim();
  if (isPlaceholder(currentJwt) || currentJwt.length < 32) {
    entries.set("JWT_SECRET", crypto.randomBytes(48).toString("hex"));
    changed = true;
  }

  if (!entries.get("JWT_EXPIRES_IN")) {
    entries.set("JWT_EXPIRES_IN", "7d");
    changed = true;
  }

  return changed;
}

function ensureProductionUploadPaths(entries) {
  let changed = false;
  const currentUploads = String(entries.get("UPLOADS_DIR") || "").trim();
  const currentStorage = String(entries.get("STORAGE_ROOT") || "").trim();
  const legacyRelative = new Set(["server/uploads", "./server/uploads"]);
  const legacyAbsolute = new Set((VPS.legacyUploadsRoots || []).map((entry) => String(entry || "").trim()).filter(Boolean));

  const shouldUpgradeUploads =
    !currentUploads ||
    legacyRelative.has(currentUploads) ||
    legacyAbsolute.has(currentUploads);

  if (shouldUpgradeUploads) {
    entries.set("UPLOADS_DIR", VPS.uploadsRoot);
    changed = true;
  }

  const shouldUpgradeStorage =
    !currentStorage ||
    legacyRelative.has(currentStorage) ||
    legacyAbsolute.has(currentStorage);

  if (shouldUpgradeStorage) {
    entries.set("STORAGE_ROOT", VPS.uploadsRoot);
    changed = true;
  }

  if (!entries.get("UPLOADS_PUBLIC_PATH")) {
    entries.set("UPLOADS_PUBLIC_PATH", VPS.publicUploadsPath || "/uploads");
    changed = true;
  }

  return changed;
}

function main() {
  const templatePath = chooseTemplatePath();
  let sourceLines = [];

  if (!fs.existsSync(envPath)) {
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Missing ${envPath} and template ${templatePath}`);
    }

    sourceLines = fs.readFileSync(templatePath, "utf8").split(/\r?\n/);
    log(`Created ${envPath} from ${path.basename(templatePath)}`);
  } else {
    sourceLines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    log(`Preserving existing ${envPath}`);
  }

  const entries = parseEnvFile(fs.existsSync(envPath) ? envPath : templatePath);
  const authChanged = ensureAuthValues(entries);
  const uploadsChanged = ensureProductionUploadPaths(entries);
  const changed = authChanged || uploadsChanged;

  if (!fs.existsSync(envPath) || changed) {
    fs.writeFileSync(envPath, serializeEnvFile(entries, sourceLines), "utf8");
    log(changed ? "Updated production environment values in .env" : "Wrote .env");
  } else {
    log("No authentication changes required");
  }
}

main();
