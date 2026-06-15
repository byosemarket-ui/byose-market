const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const config = require('./config/env');
const paths = require('./config/paths');
const createApiRouter = require('./api');
const requestLogger = require('./middleware/requestlogger');
const securityHeaders = require('./middleware/securityheaders');
const { getDatabaseStatus } = require('./database');
const { appLogger } = require('./utils/logger');
const { metricsMiddleware, getSnapshot } = require('./utils/metrics');
const { prepareStorageFoundation, getUploadFoundationSnapshot } = require('./services/storage-foundation.service');

const { PRODUCTION_CORS_ORIGINS } = require('../config/production-targets');

function getCorsOptions() {
    const fallbackProductionOrigins = PRODUCTION_CORS_ORIGINS.slice();
    const configuredOrigins = config.corsOrigins.length
        ? config.corsOrigins
        : (config.isProduction ? fallbackProductionOrigins : []);

    function matchesConfiguredOrigin(configuredOrigin, requestOrigin) {
        const expected = String(configuredOrigin || '').trim();
        const incoming = String(requestOrigin || '').trim();

        if (!expected || !incoming) {
            return false;
        }

        if (expected === '*') {
            return true;
        }

        if (expected.includes('*')) {
            const escaped = expected
                .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
                .replace(/\*/g, '.*');
            return new RegExp(`^${escaped}$`, 'i').test(incoming);
        }

        return incoming.toLowerCase() === expected.toLowerCase();
    }

    function isAllowedDevelopmentOrigin(requestOrigin) {
        if (config.isProduction) {
            return false;
        }

        try {
            const parsed = new URL(String(requestOrigin || '').trim());
            return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
        } catch (_error) {
            return false;
        }
    }

    if (!configuredOrigins.length) {
        return {
            origin: true,
            methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization'],
            credentials: false
        };
    }

    return {
        origin(origin, callback) {
            if (!origin) {
                return callback(null, true);
            }

            if (isAllowedDevelopmentOrigin(origin)) {
                return callback(null, origin);
            }

            const matchedOrigin = configuredOrigins.find((configuredOrigin) => matchesConfiguredOrigin(configuredOrigin, origin));
            if (matchedOrigin) {
                return callback(null, origin);
            }

            return callback(new Error('Origin not allowed by CORS'));
        },
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: false
    };
}

function createApp() {
    const app = express();
    const apiRouter = createApiRouter();
    const uploadFoundation = prepareStorageFoundation();

    app.locals.dbConnected = false;
    app.locals.database = getDatabaseStatus();
    app.locals.uploads = uploadFoundation;
    app.disable('x-powered-by');
    app.set('trust proxy', config.trustProxy);

    app.use(bodyParser.json({ limit: '200kb' }));
    app.use(securityHeaders);
    app.use(requestLogger);
    app.use(metricsMiddleware());
    app.use((req, _res, next) => {
        const databaseStatus = getDatabaseStatus();
        app.locals.dbConnected = Boolean(databaseStatus.ready);
        app.locals.database = databaseStatus;
        req.dbConnected = app.locals.dbConnected;
        req.database = databaseStatus;
        next();
    });

    app.get('/', (_req, res) => {
        return res.json({
            status: 'ok',
            message: 'Byose Market API is running',
            dbConnected: Boolean(app.locals.dbConnected),
            database: app.locals.database,
            uploads: getUploadFoundationSnapshot()
        });
    });

    app.get('/healthz', (_req, res) => {
        const databaseStatus = getDatabaseStatus();
        return res.status(200).json({
            status: databaseStatus.ready ? 'ok' : 'degraded',
            dbConnected: databaseStatus.ready,
            database: databaseStatus,
            uploads: getUploadFoundationSnapshot()
        });
    });

    app.get('/readyz', (_req, res) => {
        const databaseStatus = getDatabaseStatus();
        const isReady = databaseStatus.ready;
        if (!isReady) {
            res.setHeader('Retry-After', '10');
        }

        return res.status(isReady ? 200 : 503).json({
            status: isReady ? 'ready' : 'not-ready',
            dbConnected: isReady,
            database: databaseStatus,
            uploads: getUploadFoundationSnapshot()
        });
    });

    app.get('/metrics', (req, res) => {
        const expectedToken = String(process.env.METRICS_TOKEN || '').trim();
        if (expectedToken) {
            const authHeader = String(req.headers.authorization || '').trim();
            const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
            if (provided !== expectedToken) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }
        }

        return res.status(200).json(getSnapshot());
    });

    app.use('/api', cors(getCorsOptions()), apiRouter);
    app.use(config.uploads.publicMountPath, express.static(config.uploads.rootDir, {
        fallthrough: true,
        index: false,
        maxAge: config.isProduction ? '1d' : 0
    }));
    app.use(express.static(paths.projectRoot));

    app.use((error, req, res, next) => {
        if (!error) {
            return next();
        }

        const logger = req?.log || appLogger;

        if (error.type === 'entity.too.large') {
            logger.warn('request.payload_too_large', { error });
            return res.status(413).json({ success: false, message: 'Request payload too large' });
        }

        if (error.name === 'MulterError') {
            const statusCode = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
            logger.warn('request.upload_error', { error });
            return res.status(statusCode).json({
                success: false,
                code: error.code || 'UPLOAD_FAILED',
                message: error.code === 'LIMIT_FILE_SIZE' ? 'Uploaded file is too large' : 'Upload request is invalid'
            });
        }

        if (error && error.code && String(error.code).startsWith('UPLOAD_')) {
            logger.warn('request.upload_validation_failed', { error });
            return res.status(Number(error.statusCode || 400) || 400).json({
                success: false,
                code: error.code,
                message: error.message || 'Upload validation failed'
            });
        }

        if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
            logger.warn('request.invalid_json', { error });
            return res.status(400).json({ success: false, message: 'Invalid JSON payload' });
        }

        logger.error('request.unhandled_error', { error });
        return res.status(500).json({ success: false, message: 'Server error' });
    });

    return app;
}

module.exports = {
    createApp,
    getCorsOptions
};