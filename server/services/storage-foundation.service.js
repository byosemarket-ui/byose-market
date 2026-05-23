const fs = require('fs');
const path = require('path');
const config = require('../config/env');

function ensureDirectory(directoryPath) {
    fs.mkdirSync(directoryPath, { recursive: true });
}

function toPublicPath(bucket) {
    const mountPath = String(config.uploads.publicMountPath || '/uploads').replace(/\/+$/, '') || '/uploads';
    return path.posix.join(mountPath, bucket);
}

function getUploadBuckets() {
    return {
        products: {
            key: 'products',
            directory: config.uploads.productsDir,
            publicPath: toPublicPath('products')
        },
        categories: {
            key: 'categories',
            directory: config.uploads.categoriesDir,
            publicPath: toPublicPath('categories')
        },
        users: {
            key: 'users',
            directory: config.uploads.usersDir,
            publicPath: toPublicPath('users')
        },
        reviews: {
            key: 'reviews',
            directory: config.uploads.reviewsDir,
            publicPath: toPublicPath('reviews')
        },
        temp: {
            key: 'temp',
            directory: config.uploads.tempDir,
            publicPath: toPublicPath('temp')
        }
    };
}

function resolveUploadBucket(bucket) {
    const normalized = String(bucket || '').trim().toLowerCase();
    const buckets = getUploadBuckets();
    return buckets[normalized] || null;
}

function prepareStorageFoundation() {
    const buckets = Object.values(getUploadBuckets());
    ensureDirectory(config.storageRoot);
    ensureDirectory(path.dirname(config.sqlite.databasePath));
    ensureDirectory(config.sqlite.migrationsDir);
    ensureDirectory(config.uploads.rootDir);
    buckets.forEach((bucket) => {
        ensureDirectory(bucket.directory);
    });

    return getUploadFoundationSnapshot();
}

function getUploadFoundationSnapshot() {
    return {
        strategy: 'local-filesystem',
        rootDir: config.uploads.rootDir,
        publicMountPath: config.uploads.publicMountPath,
        limits: {
            maxFileSizeBytes: config.uploads.maxFileSizeBytes,
            maxFilesPerRequest: config.uploads.maxFilesPerRequest,
            allowedMimeTypes: config.uploads.allowedMimeTypes
        },
        buckets: Object.values(getUploadBuckets()).map((bucket) => ({
            key: bucket.key,
            directory: bucket.directory,
            publicPath: bucket.publicPath
        }))
    };
}

module.exports = {
    getUploadFoundationSnapshot,
    prepareStorageFoundation,
    resolveUploadBucket
};