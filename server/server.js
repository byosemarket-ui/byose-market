const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const connectDB = require('./config/db');
const requestLogger = require('./middleware/requestlogger');
const requireDatabase = require('./middleware/requiredatabase');
const securityHeaders = require('./middleware/securityheaders');
const { createRateLimiter } = require('./middleware/ratelimiter');
const { appLogger } = require('./utils/logger');
const { metricsMiddleware, getSnapshot, logSnapshot, METRIC, increment } = require('./utils/metrics');
const adminCustomerRoutes = require('./routes/admincustomers');
const adminCartRoutes = require('./routes/admincarts');
const adminDashboardRoutes = require('./routes/admindashboard');
const adminSettingsRoutes = require('./routes/adminsettings');
const adminMessageRoutes = require('./routes/adminmessages');
const adminOrderRoutes = require('./routes/adminorders');
const adminActivityRoutes = require('./routes/adminactivity');
const adminIntelligenceRoutes = require('./routes/adminintelligence');
const adminAuthRoutes = require('../admin/admin-login/admin.routes');
const activityRoutes = require('./routes/activity');
const realtimeRoutes = require('./routes/realtime');
const authRoutes = require('./routes/auth');
const messageRoutes = require('./routes/messages');
const productRoutes = require('./routes/products');
const cartRoutes = require('./routes/cart');
const orderRoutes = require('./routes/orders');
const storefrontStateRoutes = require('./routes/storefrontstate');

const app = express();
const projectRoot = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 5000;
const HOST = '0.0.0.0';
const STARTUP_RECONNECT_DELAY_MS = 5000;
let server = null;
let startupReconnectTimer = null;

app.locals.dbConnected = false;
app.disable('x-powered-by');
app.set('trust proxy', 1);

function getCorsOptions() {
    const envOrigins = String(process.env.CORS_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
    const fallbackProductionOrigins = [
        'https://byosemarket.com',
        'https://www.byosemarket.com'
    ];
    const configuredOrigins = envOrigins.length
        ? envOrigins
        : (process.env.NODE_ENV === 'production' ? fallbackProductionOrigins : []);

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
            if (!origin || configuredOrigins.some((configuredOrigin) => matchesConfiguredOrigin(configuredOrigin, origin))) {
                return callback(null, true);
            }

            return callback(new Error('Origin not allowed by CORS'));
        },
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: false
    };
}

app.use(cors(getCorsOptions()));
app.use(bodyParser.json({ limit: '200kb' }));
app.use(securityHeaders);
app.use(requestLogger);
app.use(metricsMiddleware());
app.use((req, _res, next) => {
    app.locals.dbConnected = mongoose.connection.readyState === 1;
    req.dbConnected = app.locals.dbConnected;
    next();
});

const authRateLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 20,
    code: 'AUTH_RATE_LIMITED',
    message: 'Too many authentication attempts. Please try again later.'
});

const adminRateLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 180,
    code: 'ADMIN_RATE_LIMITED',
    message: 'Too many admin requests. Please retry shortly.'
});

const realtimeRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 120,
    code: 'REALTIME_RATE_LIMITED',
    message: 'Too many realtime requests. Please retry shortly.'
});

// Connect to database
// ROUTES
app.use('/api/admin/customers', requireDatabase, adminCustomerRoutes);
app.use('/api/admin/carts', requireDatabase, adminCartRoutes);
app.use('/api/admin/dashboard', requireDatabase, adminDashboardRoutes);
app.use('/api/admin/settings', requireDatabase, adminSettingsRoutes);
app.use('/api/admin/messages', requireDatabase, adminMessageRoutes);
app.use('/api/admin/orders', requireDatabase, adminOrderRoutes);
app.use('/api/admin/activity', requireDatabase, adminActivityRoutes);
app.use('/api/admin/intelligence', requireDatabase, adminIntelligenceRoutes);
app.use('/api/admin', adminRateLimiter, adminAuthRoutes);
app.use('/api/activity', requireDatabase, activityRoutes);
app.use('/api/auth', authRateLimiter, authRoutes);
app.use('/api/messages', requireDatabase, messageRoutes);
app.use('/api/products', requireDatabase, productRoutes);
app.use('/api/cart', requireDatabase, cartRoutes);
app.use('/api/orders', requireDatabase, orderRoutes);
app.use('/api/storefront/state', requireDatabase, storefrontStateRoutes);
app.use('/api/realtime', realtimeRateLimiter, realtimeRoutes);

app.use((error, _req, res, next) => {
    if (!error) {
        return next();
    }

    const logger = _req?.log || appLogger;

    if (error.type === 'entity.too.large') {
        logger.warn('request.payload_too_large', { error });
        return res.status(413).json({ success: false, message: 'Request payload too large' });
    }

    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
        logger.warn('request.invalid_json', { error });
        return res.status(400).json({ success: false, message: 'Invalid JSON payload' });
    }

    logger.error('request.unhandled_error', { error });
    return res.status(500).json({ success: false, message: 'Server error' });
});

// TEST
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Byose Market API is running',
        dbConnected: Boolean(app.locals.dbConnected)
    });
});

app.get('/healthz', (_req, res) => {
    return res.status(200).json({
        status: mongoose.connection.readyState === 1 ? 'ok' : 'degraded',
        dbConnected: mongoose.connection.readyState === 1,
        readyState: mongoose.connection.readyState
    });
});

app.get('/readyz', (_req, res) => {
    const isReady = mongoose.connection.readyState === 1;
    if (!isReady) {
        res.setHeader('Retry-After', '10');
    }

    return res.status(isReady ? 200 : 503).json({
        status: isReady ? 'ready' : 'not-ready',
        dbConnected: isReady,
        readyState: mongoose.connection.readyState
    });
});

// Internal metrics endpoint — returns current in-process metrics snapshot.
// Protect with METRICS_TOKEN env var when exposing to external scrapers.
app.get('/metrics', (req, res) => {
    const expectedToken = String(process.env.METRICS_TOKEN || '').trim();
    if (expectedToken) {
        const authHeader = String(req.headers['authorization'] || '').trim();
        const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
        if (provided !== expectedToken) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
    }

    return res.status(200).json(getSnapshot());
});

app.use(express.static(projectRoot));

// START SERVER
function scheduleStartupReconnect() {
    if (startupReconnectTimer || app.locals.dbConnected) {
        return;
    }

    startupReconnectTimer = setTimeout(async () => {
        startupReconnectTimer = null;

        try {
            await connectDB();
            app.locals.dbConnected = true;
            appLogger.info('database.reconnected_after_startup_failure');
        } catch (error) {
            app.locals.dbConnected = false;
            appLogger.warn('database.reconnect_retry_failed', { error });
            scheduleStartupReconnect();
        }
    }, STARTUP_RECONNECT_DELAY_MS);
}

async function startServer() {
    server = app.listen(PORT, HOST, () => {
        appLogger.info('server.started', {
            host: HOST,
            port: PORT,
            healthCheckPath: '/healthz',
            adminLoginPath: '/api/admin/login'
        });
    });

    // Log a metrics snapshot every 10 minutes for persistent monitoring in log streams.
    const metricsLogTimer = setInterval(logSnapshot, 10 * 60 * 1000);
    if (typeof metricsLogTimer.unref === 'function') {
        metricsLogTimer.unref();
    }

    try {
        await connectDB();
        app.locals.dbConnected = true;
        increment(METRIC.DB_CONNECTS);
        appLogger.info('database.connected');
    } catch (error) {
        app.locals.dbConnected = false;
        increment(METRIC.DB_ERRORS);
        appLogger.error('database.unavailable_on_startup', { error });
        scheduleStartupReconnect();
    }
}

startServer().catch((error) => {
    appLogger.error('server.startup_failed', { error });
    process.exit(1);
});

async function shutdown(signal, exitCode = 0) {
    appLogger.warn('server.shutdown_started', { signal, exitCode });

    if (startupReconnectTimer) {
        clearTimeout(startupReconnectTimer);
        startupReconnectTimer = null;
    }

    try {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
    } catch (error) {
        appLogger.error('server.shutdown_http_failed', { error });
    }

    try {
        const mongoose = require('mongoose');
        if (mongoose.connection.readyState !== 0) {
            await mongoose.connection.close();
        }
    } catch (error) {
        appLogger.error('server.shutdown_mongo_failed', { error });
    }

    process.exit(exitCode);
}

process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
    void shutdown('SIGINT');
});

process.on('unhandledRejection', (reason) => {
    appLogger.error('process.unhandled_rejection', { reason });
});

process.on('uncaughtException', (error) => {
    appLogger.error('process.uncaught_exception', { error });
    void shutdown('uncaughtException', 1);
});