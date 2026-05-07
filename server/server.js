const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../backend/.env') });

const connectDB = require('./config/db');
const requestLogger = require('./middleware/requestlogger');
const requireDatabase = require('./middleware/requiredatabase');
const { appLogger } = require('./utils/logger');
const adminCustomerRoutes = require('./routes/admincustomers');
const adminDashboardRoutes = require('./routes/admindashboard');
const adminMessageRoutes = require('./routes/adminmessages');
const adminOrderRoutes = require('./routes/adminorders');
const adminActivityRoutes = require('./routes/adminactivity');
const adminAuthRoutes = require('../admin/admin-login/admin.routes');
const activityRoutes = require('./routes/activity');
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
let server = null;

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
        'https://www.byosemarket.com',
        'https://*.github.io'
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
app.use(requestLogger);

// Connect to database
// ROUTES
app.use('/api/admin/customers', requireDatabase, adminCustomerRoutes);
app.use('/api/admin/dashboard', requireDatabase, adminDashboardRoutes);
app.use('/api/admin/messages', requireDatabase, adminMessageRoutes);
app.use('/api/admin/orders', requireDatabase, adminOrderRoutes);
app.use('/api/admin/activity', requireDatabase, adminActivityRoutes);
app.use('/api/admin', adminAuthRoutes);
app.use('/api/activity', requireDatabase, activityRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/messages', requireDatabase, messageRoutes);
app.use('/api/products', requireDatabase, productRoutes);
app.use('/api/cart', requireDatabase, cartRoutes);
app.use('/api/orders', requireDatabase, orderRoutes);
app.use('/api/storefront/state', requireDatabase, storefrontStateRoutes);

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
        status: 'ok',
        dbConnected: mongoose.connection.readyState === 1
    });
});

app.use(express.static(projectRoot));

// START SERVER
async function startServer() {
    server = app.listen(PORT, HOST, () => {
        appLogger.info('server.started', {
            host: HOST,
            port: PORT,
            healthCheckPath: '/healthz',
            adminLoginPath: '/api/admin/login'
        });
    });

    try {
        await connectDB();
        app.locals.dbConnected = true;
        appLogger.info('database.connected');
    } catch (error) {
        app.locals.dbConnected = false;
        appLogger.error('database.unavailable_on_startup', { error });
    }
}

startServer().catch((error) => {
    appLogger.error('server.startup_failed', { error });
    process.exit(1);
});

async function shutdown(signal, exitCode = 0) {
    appLogger.warn('server.shutdown_started', { signal, exitCode });

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