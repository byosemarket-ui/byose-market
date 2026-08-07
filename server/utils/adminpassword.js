const fs = require('fs');
const path = require('path');
const { appLogger } = require('./logger');

const ENV_PATH = path.resolve(__dirname, '../../.env');
const BCRYPT_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

function looksLikeBcryptHash(value) {
    return BCRYPT_PATTERN.test(String(value || '').trim());
}

function getRuntimeAdminPasswordHash() {
    return String(process.env.ADMIN_PASSWORD_HASH || '').trim();
}

function setRuntimeAdminPasswordHash(passwordHash) {
    const normalized = String(passwordHash || '').trim();
    if (!looksLikeBcryptHash(normalized)) {
        throw new Error('Refusing to set an invalid admin password hash.');
    }
    process.env.ADMIN_PASSWORD_HASH = normalized;
    return normalized;
}

function persistAdminPasswordHashToEnv(passwordHash) {
    const normalized = setRuntimeAdminPasswordHash(passwordHash);

    try {
        if (!fs.existsSync(ENV_PATH)) {
            appLogger.warn('auth.admin.password_env_missing', { envPath: ENV_PATH });
            return { persisted: false, runtimeUpdated: true };
        }

        const original = fs.readFileSync(ENV_PATH, 'utf8');
        const lines = original.split(/\r?\n/);
        let replaced = false;
        const nextLines = lines.map((line) => {
            if (!/^\s*ADMIN_PASSWORD_HASH\s*=/.test(line)) {
                return line;
            }
            replaced = true;
            return `ADMIN_PASSWORD_HASH=${normalized}`;
        });

        if (!replaced) {
            if (nextLines.length && nextLines[nextLines.length - 1] !== '') {
                nextLines.push('');
            }
            nextLines.push(`ADMIN_PASSWORD_HASH=${normalized}`);
        }

        fs.writeFileSync(ENV_PATH, nextLines.join('\n'), 'utf8');
        appLogger.info('auth.admin.password_env_persisted', { replaced });
        return { persisted: true, runtimeUpdated: true, replaced };
    } catch (error) {
        appLogger.warn('auth.admin.password_env_persist_failed', {
            message: String(error?.message || 'Unable to persist admin password hash')
        });
        return { persisted: false, runtimeUpdated: true };
    }
}

module.exports = {
    getRuntimeAdminPasswordHash,
    looksLikeBcryptHash,
    persistAdminPasswordHashToEnv,
    setRuntimeAdminPasswordHash
};
