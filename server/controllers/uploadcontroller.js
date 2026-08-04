const { getUploadFoundationSnapshot, resolveUploadBucket } = require('../services/storage-foundation.service');
const { buildPublicUploadUrl, buildRelativeUploadPath, deleteManagedFiles, parsePathCollection } = require('../services/uploadstorage.service');

function serializeUploadedFile(file, bucket) {
    const relativePath = buildRelativeUploadPath(bucket.key, file.filename);
    const publicUrl = buildPublicUploadUrl(bucket.key, file.filename);

    return {
        fieldName: String(file.fieldname || '').trim(),
        originalName: String(file.originalname || '').trim(),
        filename: String(file.filename || '').trim(),
        mimeType: String(file.mimetype || '').trim().toLowerCase(),
        size: Number(file.size || 0) || 0,
        bucket: bucket.key,
        path: relativePath,
        storagePath: relativePath,
        url: publicUrl,
        publicUrl,
        thumbnailUrl: publicUrl
    };
}

function getUploadHealth(_req, res) {
    return res.status(200).json({
        success: true,
        uploads: getUploadFoundationSnapshot({ includeSensitive: false })
    });
}

function getUploadConfig(_req, res) {
    return res.status(200).json({
        success: true,
        uploads: getUploadFoundationSnapshot({ includeSensitive: true })
    });
}

function uploadFiles(req, res) {
    const bucket = req.uploadBucket || resolveUploadBucket(req.params.bucket);
    if (!bucket) {
        return res.status(404).json({
            success: false,
            message: 'Upload bucket not found.'
        });
    }

    const files = Array.isArray(req.files) ? req.files.map((file) => serializeUploadedFile(file, bucket)) : [];
    if (!files.length) {
        return res.status(400).json({
            success: false,
            code: 'UPLOAD_FILE_REQUIRED',
            message: 'At least one image file is required.'
        });
    }

    const cleanupPaths = [
        ...parsePathCollection(req.body?.cleanupPaths),
        ...parsePathCollection(req.body?.previousPaths),
        ...parsePathCollection(req.body?.removePaths)
    ];
    const removed = deleteManagedFiles(cleanupPaths);

    return res.status(201).json({
        success: true,
        bucket: {
            key: bucket.key,
            publicPath: bucket.publicPath
        },
        file: files[0],
        files,
        removed
    });
}

function deleteUploads(req, res) {
    const removed = deleteManagedFiles(parsePathCollection(req.body?.paths || req.body?.path));
    return res.status(200).json({
        success: true,
        removed
    });
}

module.exports = {
    deleteUploads,
    getUploadConfig,
    getUploadHealth,
    uploadFiles
};