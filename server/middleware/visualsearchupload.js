const multer = require('multer');
const config = require('../config/env');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: config.uploads.maxFileSizeBytes,
        files: 1
    },
    fileFilter(_req, file, callback) {
        const mimeType = String(file.mimetype || '').trim().toLowerCase();
        if (!config.uploads.allowedMimeTypes.includes(mimeType)) {
            callback(new Error('Only image uploads are allowed for visual search.'));
            return;
        }

        callback(null, true);
    }
});

function createVisualSearchUploadMiddleware() {
    return upload.single('image');
}

module.exports = {
    createVisualSearchUploadMiddleware
};
