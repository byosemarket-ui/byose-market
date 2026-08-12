/**
 * Shared guards for payment verification scripts.
 * Ensures local verify runs never overwrite or delete the real encrypted
 * payment credential store used by Admin Payment Management.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const REAL_CREDENTIALS_FILE = path.resolve(__dirname, '../../server/secure/payment-credentials.enc');
const PLACEHOLDER_TOKEN_RE = /^(LOCAL-VERIFY-|verify-token-)/i;

function isPlaceholderCompanyToken(value) {
    const text = String(value == null ? '' : value).trim();
    return !text || PLACEHOLDER_TOKEN_RE.test(text);
}

function resolveRealCredentialsPath() {
    return REAL_CREDENTIALS_FILE;
}

function isRealCredentialsPath(filePath) {
    return path.resolve(String(filePath || '')) === REAL_CREDENTIALS_FILE;
}

/**
 * Point PAYMENT_CREDENTIALS_PATH at an isolated temp file before requiring
 * secrets.store / payment settings modules. Real server/secure store is never written.
 */
function isolateVerifyCredentialStore(scriptLabel = 'verify') {
    if (String(process.env.PAYMENT_CREDENTIALS_PATH || '').trim()) {
        const current = path.resolve(process.env.PAYMENT_CREDENTIALS_PATH);
        if (isRealCredentialsPath(current)) {
            throw new Error(
                `[${scriptLabel}] PAYMENT_CREDENTIALS_PATH points at the real encrypted store. Refusing to continue.`
            );
        }
        return {
            realPath: REAL_CREDENTIALS_FILE,
            isolatedPath: current,
            tmpDir: path.dirname(current),
            reused: true
        };
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byose-payment-verify-'));
    const isolatedPath = path.join(tmpDir, 'payment-credentials.enc');
    process.env.PAYMENT_CREDENTIALS_PATH = isolatedPath;

    console.log(
        `[${scriptLabel}] isolated payment credential store active (real store untouched): ${isolatedPath}`
    );

    return {
        realPath: REAL_CREDENTIALS_FILE,
        isolatedPath,
        tmpDir,
        reused: false
    };
}

/**
 * Never delete server/secure/payment-credentials.enc.
 * Isolated verify stores may be removed when undecryptable.
 */
function resetUndecryptableStoreIfSafe(secretsStore, scriptLabel = 'verify') {
    try {
        secretsStore.readStore();
        return { reset: false };
    } catch (error) {
        const safeCodes = [
            'PAYMENT_CREDENTIALS_DECRYPT_FAILED',
            'PAYMENT_CREDENTIALS_CORRUPT',
            'PAYMENT_ENCRYPTION_KEY_MISSING'
        ];
        if (!safeCodes.includes(error?.code)) {
            throw error;
        }

        const storePath = typeof secretsStore.getCredentialsFilePath === 'function'
            ? secretsStore.getCredentialsFilePath()
            : REAL_CREDENTIALS_FILE;

        if (isRealCredentialsPath(storePath)) {
            console.warn(
                `[${scriptLabel}] refusing to delete real payment-credentials.enc (${error.code}); using isolated verify store instead`
            );
            const isolated = isolateVerifyCredentialStore(scriptLabel);
            // Clear require cache so subsequent reads use the new path if module already loaded.
            return { reset: false, isolated, refusedRealDelete: true, code: error.code };
        }

        if (fs.existsSync(storePath)) {
            fs.unlinkSync(storePath);
            console.log(`[${scriptLabel}] reset undecryptable isolated payment-credentials.enc`);
        }
        return { reset: true, code: error.code };
    }
}

function assertNotWritingPlaceholderIntoRealStore(companyToken, scriptLabel = 'verify') {
    const target = String(process.env.PAYMENT_CREDENTIALS_PATH || REAL_CREDENTIALS_FILE).trim();
    if (isRealCredentialsPath(target) && isPlaceholderCompanyToken(companyToken)) {
        throw new Error(
            `[${scriptLabel}] blocked writing placeholder Company Token into the real encrypted payment store`
        );
    }
}

/**
 * Capture payment settings flags so verify scripts can restore them.
 * Does not snapshot secrets — credentials stay in the isolated enc store.
 */
async function snapshotPaymentSettingsFlags(paymentSettingsService) {
    const current = await paymentSettingsService.getAdminPaymentSettings();
    const active = (current.providers || []).find((entry) => entry.id === current.activeProvider) || null;
    return {
        enabled: Boolean(current.enabled),
        activeProvider: String(current.activeProvider || 'dpo'),
        mode: current.mode === 'live' ? 'live' : 'test',
        providerEnabled: active ? active.enabled !== false : true
    };
}

async function restorePaymentSettingsFlags(paymentSettingsService, snapshot, admin = {}) {
    if (!snapshot || typeof snapshot !== 'object') {
        return null;
    }
    return paymentSettingsService.updatePaymentSettings({
        enabled: Boolean(snapshot.enabled),
        activeProvider: String(snapshot.activeProvider || 'dpo'),
        mode: snapshot.mode === 'live' ? 'live' : 'test',
        providerEnabled: snapshot.providerEnabled !== false
    }, {
        id: admin.id || 'ADMIN_VERIFY_RESTORE',
        email: admin.email || 'admin@example.com'
    });
}

module.exports = {
    PLACEHOLDER_TOKEN_RE,
    REAL_CREDENTIALS_FILE,
    assertNotWritingPlaceholderIntoRealStore,
    isolateVerifyCredentialStore,
    isPlaceholderCompanyToken,
    isRealCredentialsPath,
    resetUndecryptableStoreIfSafe,
    resolveRealCredentialsPath,
    restorePaymentSettingsFlags,
    snapshotPaymentSettingsFlags
};
