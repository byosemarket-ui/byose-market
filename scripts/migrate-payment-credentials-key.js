#!/usr/bin/env node
/**
 * Production-safe payment credential re-encryption migration.
 * Decrypts payment-credentials.enc with JWT_SECRET_DERIVED and re-encrypts
 * with PAYMENT_ENCRYPTION_KEY. Never prints secrets.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.cwd();
require('dotenv').config({ path: path.resolve(ROOT, '.env') });

const SECURE_DIR = path.resolve(ROOT, 'server/secure');
const CREDENTIALS_FILE = path.resolve(SECURE_DIR, 'payment-credentials.enc');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function sha12(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, 12);
}

function deriveKey(material) {
  return crypto.scryptSync(material, 'byosemarket-payment-secrets-v1', KEY_LENGTH);
}

function decryptWithMaterial(encoded, material) {
  const packed = Buffer.from(String(encoded || ''), 'base64');
  const header = packed.subarray(0, 5).toString('utf8');
  if (header !== 'BMPE1') {
    throw new Error('PAYMENT_CREDENTIALS_CORRUPT');
  }
  const key = deriveKey(material);
  const iv = packed.subarray(5, 5 + IV_LENGTH);
  const authTag = packed.subarray(5 + IV_LENGTH, 5 + IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = packed.subarray(5 + IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

function encryptWithMaterial(plainObject, material) {
  const key = deriveKey(material);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(plainObject || {}), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('BMPE1'), iv, authTag, encrypted]).toString('base64');
}

function summarize(data) {
  const dpo = (data && data.providers && data.providers.dpo) || {};
  const test = dpo.test || {};
  const live = dpo.live || {};
  return {
    providers: Object.keys((data && data.providers) || {}),
    modes: Object.keys(dpo),
    testTokenLen: String(test.companyToken || '').trim().length,
    testTokenHint: String(test.companyToken || '').trim().slice(-4) || null,
    testServiceTypeLen: String(test.serviceType || '').trim().length,
    liveTokenConfigured: Boolean(String(live.companyToken || '').trim()),
    updatedAt: data.updatedAt || null
  };
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const apply = process.argv.includes('--apply');
  if (!dryRun && !apply) {
    console.error(JSON.stringify({ ok: false, error: 'Pass --dry-run or --apply' }));
    process.exit(1);
  }

  const paymentKey = String(process.env.PAYMENT_ENCRYPTION_KEY || '').trim();
  const jwt = String(process.env.JWT_SECRET || '').trim();
  if (!paymentKey) {
    console.error(JSON.stringify({ ok: false, error: 'PAYMENT_ENCRYPTION_KEY missing' }));
    process.exit(1);
  }
  if (!jwt || jwt === 'replace_with_a_long_random_secret') {
    console.error(JSON.stringify({ ok: false, error: 'JWT_SECRET missing' }));
    process.exit(1);
  }

  const derived = `byose-payment-v1:${jwt}`;
  const encoded = fs.readFileSync(CREDENTIALS_FILE, 'utf8').trim();
  const beforeHash = sha12(encoded);

  let data;
  let sourceLabel = null;
  try {
    data = decryptWithMaterial(encoded, derived);
    sourceLabel = 'JWT_SECRET_DERIVED';
  } catch (error) {
    try {
      data = decryptWithMaterial(encoded, paymentKey);
      sourceLabel = 'PAYMENT_ENCRYPTION_KEY';
    } catch (error2) {
      console.error(JSON.stringify({
        ok: false,
        error: 'DECRYPT_FAILED_BOTH',
        jwtDerived: error.message,
        paymentKey: error2.message
      }));
      process.exit(1);
    }
  }

  const summary = summarize(data);
  let alreadyOnPaymentKey = false;
  try {
    decryptWithMaterial(encoded, paymentKey);
    alreadyOnPaymentKey = true;
  } catch (_error) {
    alreadyOnPaymentKey = false;
  }

  const report = {
    ok: true,
    dryRun,
    apply,
    sourceLabel,
    alreadyOnPaymentKey,
    beforeHash,
    paymentKeyFp: sha12(paymentKey),
    derivedFp: sha12(derived),
    summary
  };

  if (sourceLabel === 'PAYMENT_ENCRYPTION_KEY' || alreadyOnPaymentKey) {
    report.action = 'none_needed';
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (dryRun) {
    report.action = 'would_reencrypt_with_PAYMENT_ENCRYPTION_KEY';
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.resolve(SECURE_DIR, `payment-credentials.enc.bak-${stamp}`);
  fs.copyFileSync(CREDENTIALS_FILE, backupPath);
  fs.chmodSync(backupPath, 0o600);

  const nextEncoded = encryptWithMaterial({
    providers: data.providers || {},
    updatedAt: new Date().toISOString()
  }, paymentKey);

  const tmpPath = `${CREDENTIALS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, nextEncoded, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmpPath, CREDENTIALS_FILE);
  try { fs.chmodSync(CREDENTIALS_FILE, 0o600); } catch (_e) { /* ignore */ }

  // Verify with PAYMENT_ENCRYPTION_KEY
  const verified = decryptWithMaterial(fs.readFileSync(CREDENTIALS_FILE, 'utf8').trim(), paymentKey);
  const afterSummary = summarize(verified);

  report.action = 'reencrypted';
  report.backupPath = path.basename(backupPath);
  report.afterHash = sha12(nextEncoded);
  report.afterSummary = afterSummary;
  report.verifyOk = afterSummary.testTokenLen === summary.testTokenLen
    && afterSummary.testTokenHint === summary.testTokenHint
    && afterSummary.testServiceTypeLen === summary.testServiceTypeLen;

  if (!report.verifyOk) {
    // restore backup
    fs.copyFileSync(backupPath, CREDENTIALS_FILE);
    report.restoredBackup = true;
    report.ok = false;
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(report, null, 2));
}

main();
