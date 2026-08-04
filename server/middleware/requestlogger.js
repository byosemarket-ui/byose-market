const { appLogger, redactValue } = require('../utils/logger');

function buildRequestId() {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isStaticAsset(requestPath) {
    return /\.(?:css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf)(?:\?|$)/i.test(requestPath)
        || requestPath.startsWith('/uploads/');
}

function requestLogger(req, res, next) {
    const requestPath = String(req.originalUrl || req.url || '');
    if (isStaticAsset(requestPath)) {
        return next();
    }

    const requestId = buildRequestId();
    const startedAt = Date.now();
    const logger = appLogger.child({
        requestId,
        method: req.method,
        path: requestPath,
        ip: req.ip,
        userAgent: req.get('user-agent') || '',
        query: redactValue(req.query || {}),
        bodyKeys: Object.keys(req.body && typeof req.body === 'object' ? req.body : {})
    });

    req.requestId = requestId;
    req.log = logger;
    res.setHeader('X-Request-Id', requestId);

    logger.info('request.start');

    res.on('finish', () => {
        const durationMs = Date.now() - startedAt;
        const payload = {
            statusCode: res.statusCode,
            durationMs,
            contentLength: Number(res.getHeader('content-length') || 0) || undefined
        };

        if (res.statusCode >= 500) {
            logger.error('request.finish', payload);
            return;
        }

        if (res.statusCode >= 400 || durationMs >= 1500) {
            logger.warn('request.finish', payload);
            return;
        }

        logger.info('request.finish', payload);
    });

    return next();
}

module.exports = requestLogger;
