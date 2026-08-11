/**
 * Encrypted server-side store for payment provider credentials.
 * Secrets never leave this module in API responses — callers must sanitize.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const paths = require('../config/paths');

const SECURE_DIR = path.resolve(paths.serverRoot, 'secure');
const DEFAULT_CREDENTIALS_FILE = path.resolve(SECURE_DIR, 'payment-credentials.enc');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Production/admin path is server/secure/payment-credentials.enc.
 * Verification scripts may set PAYMENT_CREDENTIALS_PATH to an isolated temp file
 * so they never overwrite real merchant credentials.
 */
function getCredentialsFilePath() {
    const override = String(process.env.PAYMENT_CREDENTIALS_PATH || '').trim();
    if (override) {
        return path.resolve(override);
    }
    return DEFAULT_CREDENTIALS_FILE;
}

function ensureSecureDirForCredentials() {
    const credentialsFile = getCredentialsFilePath();
    const dir = path.dirname(credentialsFile);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    // Keep the canonical secure directory present for production deployments.
    if (!fs.existsSync(SECURE_DIR)) {
        fs.mkdirSync(SECURE_DIR, { recursive: true, mode: 0o700 });
    }
}

function resolveEncryptionKeyMaterial() {
    const explicit = String(process.env.PAYMENT_ENCRYPTION_KEY || '').trim();
    if (explicit) {
        return { material: explicit, source: 'PAYMENT_ENCRYPTION_KEY' };
    }

    const jwtSecret = String(process.env.JWT_SECRET || '').trim();
    if (jwtSecret && jwtSecret !== 'replace_with_a_long_random_secret') {
        return { material: `byose-payment-v1:${jwtSecret}`, source: 'JWT_SECRET_DERIVED' };
    }

    return { material: '', source: 'missing' };
}

function deriveKey(material) {
    return crypto.scryptSync(material, 'byosemarket-payment-secrets-v1', KEY_LENGTH);
}

function getKey() {
    const { material, source } = resolveEncryptionKeyMaterial();
    if (!material) {
        const error = new Error(
            'Payment encryption key is not configured. Set PAYMENT_ENCRYPTION_KEY in the server .env file.'
        );
        error.statusCode = 503;
        error.code = 'PAYMENT_ENCRYPTION_KEY_MISSING';
        throw error;
    }
    return { key: deriveKey(material), source };
}

function encryptPayload(plainObject) {
    const { key, source } = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const plaintext = Buffer.from(JSON.stringify(plainObject || {}), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const packed = Buffer.concat([
        Buffer.from('BMPE1'),
        iv,
        authTag,
        encrypted
    ]);
    return {
        encoded: packed.toString('base64'),
        keySource: source
    };
}

function decryptPayload(encoded) {
    const { key, source } = getKey();
    const packed = Buffer.from(String(encoded || ''), 'base64');
    const header = packed.subarray(0, 5).toString('utf8');
    if (header !== 'BMPE1') {
        const error = new Error('Payment credentials file is corrupt or unrecognized.');
        error.statusCode = 500;
        error.code = 'PAYMENT_CREDENTIALS_CORRUPT';
        throw error;
    }

    const iv = packed.subarray(5, 5 + IV_LENGTH);
    const authTag = packed.subarray(5 + IV_LENGTH, 5 + IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = packed.subarray(5 + IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    try {
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        const parsed = JSON.parse(decrypted.toString('utf8'));
        return {
            data: parsed && typeof parsed === 'object' ? parsed : {},
            keySource: source
        };
    } catch (_error) {
        const error = new Error('Unable to decrypt payment credentials. Check PAYMENT_ENCRYPTION_KEY.');
        error.statusCode = 500;
        error.code = 'PAYMENT_CREDENTIALS_DECRYPT_FAILED';
        throw error;
    }
}

function readStore() {
    ensureSecureDirForCredentials();
    const credentialsFile = getCredentialsFilePath();
    if (!fs.existsSync(credentialsFile)) {
        return { providers: {}, updatedAt: null };
    }

    const encoded = fs.readFileSync(credentialsFile, 'utf8').trim();
    if (!encoded) {
        return { providers: {}, updatedAt: null };
    }

    if (!isEncryptionConfigured()) {
        const error = new Error(
            'Payment credentials exist but PAYMENT_ENCRYPTION_KEY is not configured on the server.'
        );
        error.statusCode = 503;
        error.code = 'PAYMENT_ENCRYPTION_KEY_MISSING';
        throw error;
    }

    const { data } = decryptPayload(encoded);
    return {
        providers: data.providers && typeof data.providers === 'object' ? data.providers : {},
        updatedAt: data.updatedAt || null
    };
}

/**
 * Read-only admin views should not hard-fail when the encryption key is missing
 * or a previous test wrote credentials under a different key.
 */
function safeReadStore() {
    try {
        return readStore();
    } catch (error) {
        if (
            error?.code === 'PAYMENT_ENCRYPTION_KEY_MISSING'
            || error?.code === 'PAYMENT_CREDENTIALS_DECRYPT_FAILED'
            || error?.code === 'PAYMENT_CREDENTIALS_CORRUPT'
        ) {
            return { providers: {}, updatedAt: null, readError: error.code };
        }
        throw error;
    }
}

function writeStore(store) {
    ensureSecureDirForCredentials();
    const credentialsFile = getCredentialsFilePath();
    const payload = {
        providers: store.providers && typeof store.providers === 'object' ? store.providers : {},
        updatedAt: new Date().toISOString()
    };
    const { encoded } = encryptPayload(payload);
    const tempPath = `${credentialsFile}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, encoded, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, credentialsFile);
    try {
        fs.chmodSync(credentialsFile, 0o600);
    } catch (_error) {
        // Windows may ignore chmod; file still exists and is gitignored.
    }
    return payload;
}

function getProviderModeSecrets(providerId, mode) {
    const store = safeReadStore();
    const provider = store.providers[providerId];
    if (!provider || typeof provider !== 'object') {
        return {};
    }
    const modeSecrets = provider[mode];
    return modeSecrets && typeof modeSecrets === 'object' ? { ...modeSecrets } : {};
}

function upsertProviderModeSecrets(providerId, mode, nextSecrets = {}) {
    const store = readStore();
    const providers = { ...store.providers };
    const existingProvider = providers[providerId] && typeof providers[providerId] === 'object'
        ? { ...providers[providerId] }
        : {};
    const existingMode = existingProvider[mode] && typeof existingProvider[mode] === 'object'
        ? { ...existingProvider[mode] }
        : {};

    const merged = { ...existingMode };
    Object.keys(nextSecrets || {}).forEach((key) => {
        const value = String(nextSecrets[key] == null ? '' : nextSecrets[key]).trim();
        if (value) {
            merged[key] = value;
        }
    });

    existingProvider[mode] = merged;
    providers[providerId] = existingProvider;
    return writeStore({ providers });
}

function clearProviderModeSecret(providerId, mode, fieldKey) {
    const store = readStore();
    const providers = { ...store.providers };
    const existingProvider = providers[providerId] && typeof providers[providerId] === 'object'
        ? { ...providers[providerId] }
        : {};
    const existingMode = existingProvider[mode] && typeof existingProvider[mode] === 'object'
        ? { ...existingProvider[mode] }
        : {};
    delete existingMode[fieldKey];
    existingProvider[mode] = existingMode;
    providers[providerId] = existingProvider;
    return writeStore({ providers });
}

function isEncryptionConfigured() {
    return Boolean(resolveEncryptionKeyMaterial().material);
}

function getEncryptionStatus() {
    const { source } = resolveEncryptionKeyMaterial();
    const store = safeReadStore();
    return {
        configured: source !== 'missing',
        source: source === 'missing' ? null : source,
        storePath: 'server/secure/payment-credentials.enc',
        storeReadable: !store.readError,
        storeReadError: store.readError || null
    };
}

module.exports = {
    CREDENTIALS_FILE: DEFAULT_CREDENTIALS_FILE,
    DEFAULT_CREDENTIALS_FILE,
    SECURE_DIR,
    clearProviderModeSecret,
    getCredentialsFilePath,
    getEncryptionStatus,
    getProviderModeSecrets,
    isEncryptionConfigured,
    readStore,
    safeReadStore,
    upsertProviderModeSecrets,
    writeStore
};
