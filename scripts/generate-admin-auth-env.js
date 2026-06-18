#!/usr/bin/env node
/**
 * Generates ADMIN_PASSWORD_HASH and JWT_SECRET for production .env setup.
 * Usage:
 *   node scripts/generate-admin-auth-env.js
 *   node scripts/generate-admin-auth-env.js --password "your-password"
 *
 * Never commit the printed password. Only copy HASH and JWT lines into the VPS .env file.
 */
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const BCRYPT_ROUNDS = 12;

function parseArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return "";
  }

  return String(process.argv[index + 1] || "").trim();
}

async function main() {
  const password = parseArg("--password");
  if (!password) {
    console.error("Usage: node scripts/generate-admin-auth-env.js --password \"your-secure-password\"");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const jwtSecret = crypto.randomBytes(48).toString("hex");

  console.log("Add or update these lines in the VPS .env file:");
  console.log("");
  console.log(`ADMIN_EMAIL=byosemarket@gmail.com`);
  console.log(`ADMIN_PASSWORD_HASH=${passwordHash}`);
  console.log(`JWT_SECRET=${jwtSecret}`);
  console.log(`JWT_EXPIRES_IN=7d`);
  console.log("");
  console.log("Do not commit the plain password or .env file to git.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
