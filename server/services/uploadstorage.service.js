const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/env');

const MIME_EXTENSION_MAP = {
    'image/avif': '.avif',
    'image/gif': '.gif',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp'
};

function normalizeText(value, fallback = '') {
    const normalized = String(value || '').trim();
    return normalized || fallback;
}

function normalizeRelativePath(value) {
    const normalized = normalizeText(value)
        .replace(/\\+/g, '/')
        .replace(/^\/+/, '')
        .trim();

    if (!normalized || normalized.includes('..')) {
        return '';
    }

    return normalized;
}

function getPublicMountPrefix() {
    return String(config.uploads.publicMountPath || '/uploads').replace(/\/+$/, '') || '/uploads';
}

function createUploadFilename(originalName, mimeType) {
    const sourceExtension = path.extname(normalizeText(originalName)).toLowerCase();
    const resolvedExtension = MIME_EXTENSION_MAP[normalizeText(mimeType).toLowerCase()] || sourceExtension || '.bin';
    const safeExtension = /^[.][a-z0-9]{2,10}$/i.test(resolvedExtension) ? resolvedExtension : '.bin';
    return `${crypto.randomUUID()}${safeExtension}`;
}

function buildRelativeUploadPath(bucketKey, fileName) {
    return path.posix.join(normalizeText(bucketKey).toLowerCase(), normalizeText(fileName));
}

function buildPublicUploadUrl(bucketKey, fileName) {
    return path.posix.join(getPublicMountPrefix(), buildRelativeUploadPath(bucketKey, fileName));
}

function buildPublicUrlFromPath(value) {
    const normalized = normalizeManagedPath(value);
    if (!normalized) {
        return normalizeText(value);
    }

    return path.posix.join(getPublicMountPrefix(), normalized);
}

function normalizeManagedPath(value) {

    const rawValue = normalizeText(value);
    if (!rawValue) {
        return '';
    }

    const publicMountPrefix = getPublicMountPrefix();
    const mountPrefixWithSlash = `${publicMountPrefix}/`;

    if (rawValue.startsWith(mountPrefixWithSlash)) {
        return normalizeRelativePath(rawValue.slice(mountPrefixWithSlash.length));
    }

    try {
        const parsed = new URL(rawValue);
        if (parsed.pathname.startsWith(mountPrefixWithSlash)) {
            return normalizeRelativePath(parsed.pathname.slice(mountPrefixWithSlash.length));
        }
    } catch (_error) {
        // Ignore URL parsing failures and continue with filesystem/path checks.
    }

    if (path.isAbsolute(rawValue)) {
        const rootDir = path.resolve(config.uploads.rootDir);
        const absolutePath = path.resolve(rawValue);
        if (absolutePath === rootDir || absolutePath.startsWith(`${rootDir}${path.sep}`)) {
            return normalizeRelativePath(path.relative(rootDir, absolutePath));
        }
        return '';
    }

    return normalizeRelativePath(rawValue);
}

function isManagedUploadPath(value) {
    return Boolean(normalizeManagedPath(value));
}

function resolveManagedAbsolutePath(value) {
    const normalized = normalizeManagedPath(value);
    if (!normalized) {
        return '';
    }

    const absolutePath = path.resolve(config.uploads.rootDir, normalized);
    const rootDir = path.resolve(config.uploads.rootDir);
    if (absolutePath !== rootDir && !absolutePath.startsWith(`${rootDir}${path.sep}`)) {
        return '';
    }

    return absolutePath;
}

function toDeletedUploadDescriptor(relativePath) {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized) {
        return null;
    }

    const [bucketKey = '', fileName = ''] = normalized.split('/');
    return {
        bucket: bucketKey,
        path: normalized,
        storagePath: normalized,
        url: buildPublicUploadUrl(bucketKey, fileName),
        publicUrl: buildPublicUploadUrl(bucketKey, fileName)
    };
}

function deleteManagedFiles(values = []) {
    const candidates = Array.isArray(values) ? values : [values];
    const deleted = [];
    const seen = new Set();

    candidates.forEach((value) => {
        const normalized = normalizeManagedPath(value);
        if (!normalized || seen.has(normalized)) {
            return;
        }

        seen.add(normalized);
        const absolutePath = resolveManagedAbsolutePath(normalized);
        if (!absolutePath || !fs.existsSync(absolutePath)) {
            return;
        }
        try {
            fs.unlinkSync(absolutePath);
        } catch (err) {
            try {
                const logger = require('../utils/logger').appLogger;
                logger.warn('storage.delete_file_failed', { path: absolutePath, error: String(err?.message || err) });
            } catch (_e) {
                // ignore logger failures
            }
            return;
        }
        const descriptor = toDeletedUploadDescriptor(normalized);
        if (descriptor) {
            deleted.push(descriptor);
        }
    });

    return deleted;
}

function parsePathCollection(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeText(entry)).filter(Boolean);
    }

    const normalized = normalizeText(value);
    if (!normalized) {
        return [];
    }

    if (normalized.startsWith('[')) {
        try {
            const parsed = JSON.parse(normalized);
            return Array.isArray(parsed) ? parsed.map((entry) => normalizeText(entry)).filter(Boolean) : [];
        } catch (_error) {
            return [];
        }
    }

    return normalized.split(',').map((entry) => normalizeText(entry)).filter(Boolean);
}

function collectProductManagedPaths(product) {
    const candidates = [
        product?.image,
        product?.mainImage,
        product?.thumbnail,
        ...(Array.isArray(product?.gallery) ? product.gallery : []),
        product?.mainImageStoragePath,
        ...(Array.isArray(product?.galleryStoragePaths) ? product.galleryStoragePaths : [])
    ];

    return Array.from(new Set(candidates.map((entry) => normalizeManagedPath(entry)).filter(Boolean)));
}

module.exports = {
    buildPublicUploadUrl,
    buildPublicUrlFromPath,
    buildRelativeUploadPath,
    collectProductManagedPaths,
    createUploadFilename,
    deleteManagedFiles,
    isManagedUploadPath,
    normalizeManagedPath,
    parsePathCollection,
    resolveManagedAbsolutePath
};