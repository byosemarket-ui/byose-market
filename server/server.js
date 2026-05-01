require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const connectDB = require('./config/db');
const adminCustomerRoutes = require('./routes/admincustomers');
const adminOrderRoutes = require('./routes/adminorders');
const backendAdminRoutes = require('../backend/routes/adminRoutes');
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const cartRoutes = require('./routes/cart');
const orderRoutes = require('./routes/orders');

const app = express();
const projectRoot = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 5000;
const HOST = String(process.env.HOST || '0.0.0.0').trim() || '0.0.0.0';

app.locals.dbConnected = false;

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
app.use(bodyParser.json());

// Connect to database
// ROUTES
app.use('/api/admin/customers', adminCustomerRoutes);
app.use('/api/admin/orders', adminOrderRoutes);
app.use('/api/admin', backendAdminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use(express.static(projectRoot));

// TEST
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Byose Market API is running',
        dbConnected: Boolean(app.locals.dbConnected)
    });
});

app.get('/healthz', (_req, res) => {
    const isHealthy = Boolean(app.locals.dbConnected);
    return res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'ok' : 'degraded',
        dbConnected: isHealthy
    });
});

// START SERVER
async function startServer() {
    app.listen(PORT, HOST, () => {
        console.log(`Server running on http://${HOST}:${PORT}`);
        console.log(`Health endpoint: http://${HOST}:${PORT}/healthz`);
        console.log(`Admin login endpoint: POST http://${HOST}:${PORT}/api/admin/login`);
    });

    try {
        await connectDB();
        app.locals.dbConnected = true;
    } catch (error) {
        app.locals.dbConnected = false;
        console.error('Server started without MongoDB connectivity. DB-backed routes may fail until MongoDB is reachable.');
    }
}

startServer().catch((error) => {
    console.error('Server startup failed:', error);
    process.exit(1);
});