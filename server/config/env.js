const path = require('path');
const dotenv = require('dotenv');
const paths = require('./paths');

dotenv.config({ path: path.resolve(paths.projectRoot, '.env') });
dotenv.config({ path: path.resolve(paths.projectRoot, 'backend/.env') });

function readText(value, fallback = '') {
    const normalized = String(value || '').trim();
    return normalized || fallback;
}

function readNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(value, fallback = false) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
        return fallback;
    }

    return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function resolveProjectPath(value, fallback) {
    const normalized = readText(value);
    if (!normalized) {
        return fallback;
    }

    return path.isAbsolute(normalized)
        ? normalized
        : path.resolve(paths.projectRoot, normalized);
}

const nodeEnv = readText(process.env.NODE_ENV, 'development');
const databaseClient = readText(process.env.DB_CLIENT, 'sqlite').toLowerCase();
const corsOrigins = readText(process.env.CORS_ORIGINS)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
const uploadsRoot = resolveProjectPath(process.env.UPLOADS_DIR, paths.uploadsRoot);
const sqliteDatabasePath = resolveProjectPath(process.env.SQLITE_DB_PATH, paths.sqlite.databaseFile);
const storageRoot = resolveProjectPath(process.env.STORAGE_ROOT, paths.uploadsRoot);

const uploadAllowedMimeTypes = readText(process.env.UPLOAD_ALLOWED_MIME_TYPES, 'image/jpeg,image/png,image/webp,image/gif,image/avif')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

module.exports = {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port: readNumber(process.env.PORT, 5000),
    host: readText(process.env.HOST, '0.0.0.0'),
    trustProxy: readNumber(process.env.TRUST_PROXY, 1),
    startupReconnectDelayMs: readNumber(process.env.STARTUP_RECONNECT_DELAY_MS, 5000),
    appBaseUrl: readText(process.env.APP_BASE_URL),
    apiBaseUrl: readText(process.env.API_BASE_URL),
    corsOrigins,
    databaseClient,
    mongo: {
        uri: readText(process.env.MONGO_URI),
        devUri: readText(process.env.MONGO_URI_DEV)
    },
    sqlite: {
        enabled: readBoolean(process.env.SQLITE_ENABLED, databaseClient === 'sqlite'),
        databasePath: sqliteDatabasePath,
        migrationsDir: resolveProjectPath(process.env.SQLITE_MIGRATIONS_DIR, paths.sqlite.migrations)
    },
    uploads: {
        rootDir: uploadsRoot,
        publicMountPath: readText(process.env.UPLOADS_PUBLIC_PATH, '/uploads'),
        productsDir: path.resolve(uploadsRoot, 'products'),
        categoriesDir: path.resolve(uploadsRoot, 'categories'),
        usersDir: path.resolve(uploadsRoot, 'users'),
        reviewsDir: path.resolve(uploadsRoot, 'reviews'),
        heroDir: path.resolve(uploadsRoot, 'hero'),
        tempDir: path.resolve(uploadsRoot, 'temp'),
        maxFileSizeBytes: readNumber(process.env.UPLOAD_MAX_FILE_SIZE_BYTES, 5 * 1024 * 1024),
        maxFilesPerRequest: readNumber(process.env.UPLOAD_MAX_FILES_PER_REQUEST, 10),
        allowedMimeTypes: uploadAllowedMimeTypes
    },
    storageRoot,
    pm2: {
        appName: readText(process.env.PM2_APP_NAME, 'byosemarket-api')
    },
    auth: {
        adminEmail: readText(process.env.ADMIN_EMAIL),
        adminPasswordHash: readText(process.env.ADMIN_PASSWORD_HASH),
        jwtSecret: readText(process.env.JWT_SECRET),
        jwtExpiresIn: readText(process.env.JWT_EXPIRES_IN, '7d')
    }
};