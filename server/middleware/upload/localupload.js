const multer = require('multer');
const config = require('../../config/env');
const { resolveUploadBucket } = require('../../services/storage-foundation.service');
const { createUploadFilename } = require('../../services/uploadstorage.service');

class UploadValidationError extends Error {
    constructor(message, statusCode = 400, code = 'UPLOAD_VALIDATION_FAILED') {
        super(message);
        this.name = 'UploadValidationError';
        this.statusCode = statusCode;
        this.code = code;
    }
}

function isAllowedMimeType(mimeType) {
    return config.uploads.allowedMimeTypes.includes(String(mimeType || '').trim().toLowerCase());
}

function createLocalUploadMiddleware() {
    return function localUploadMiddleware(req, res, next) {
        const bucket = resolveUploadBucket(req.params.bucket);
        if (!bucket) {
            return res.status(404).json({
                success: false,
                code: 'UPLOAD_BUCKET_NOT_FOUND',
                message: 'Upload bucket not found.'
            });
        }

        const upload = multer({
            storage: multer.diskStorage({
                destination(_req, _file, callback) {
                    callback(null, bucket.directory);
                },
                filename(_req, file, callback) {
                    callback(null, createUploadFilename(file.originalname, file.mimetype));
                }
            }),
            limits: {
                fileSize: config.uploads.maxFileSizeBytes,
                files: config.uploads.maxFilesPerRequest
            },
            fileFilter(_req, file, callback) {
                if (!isAllowedMimeType(file.mimetype)) {
                    callback(new UploadValidationError('Only image uploads are allowed.', 400, 'UPLOAD_INVALID_MIME_TYPE'));
                    return;
                }

                callback(null, true);
            }
        }).any();

        upload(req, res, (error) => {
            if (error) {
                return next(error);
            }

            req.uploadBucket = bucket;
            return next();
        });
    };
}

module.exports = {
    UploadValidationError,
    createLocalUploadMiddleware
};