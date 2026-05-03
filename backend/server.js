const path = require('path');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const HOST = '0.0.0.0';
const fallbackProductionOrigins = [
    'https://byosemarket.com',
    'https://www.byosemarket.com',
    'https://kwize250.github.io',
    'https://*.github.io'
];

// CORS: allow all origins in development; restrict when CORS_ORIGINS is set
function getCorsOptions() {
    const envOrigins = String(process.env.CORS_ORIGINS || '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
    const configuredOrigins = envOrigins.length
        ? envOrigins
        : (process.env.NODE_ENV === 'production' ? fallbackProductionOrigins : []);

    // Always allow localhost and 127.0.0.1 in development
    const alwaysAllowed = [
        'http://localhost:5500',
        'http://127.0.0.1:5500',
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:5000',
        'http://127.0.0.1:5000'
    ];

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

    return {
        origin(origin, callback) {
            // Allow requests with no origin (e.g., Postman, curl, or mobile apps)
            if (!origin) {
                console.log('✔ CORS: No origin header (allowed for Postman/curl)');
                return callback(null, true);
            }

            // Check if origin is in always-allowed list
            if (alwaysAllowed.some(allowed => allowed.toLowerCase() === origin.toLowerCase())) {
                return callback(null, true);
            }

            // Check if origin matches configured origins
            if (configuredOrigins.length > 0) {
                if (configuredOrigins.some((configuredOrigin) => matchesConfiguredOrigin(configuredOrigin, origin))) {
                    return callback(null, true);
                }
            }

            console.warn(`⚠ CORS rejected origin: ${origin}`);
            return callback(new Error('Origin not allowed by CORS'));
        },
        credentials: false,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    };
}

app.use(cors(getCorsOptions()));
app.use(express.json());

app.get('/', (_req, res) => {
    res.json({ status: 'ok', message: 'Byose Market Admin API is running' });
});

app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});

// 🔐 Mount admin routes
try {
    const adminRoutes = require('../admin/admin-login/admin.routes');
    app.use('/api/admin', adminRoutes);
    console.log('✔ Admin routes mounted at /api/admin');
} catch (error) {
    console.error('❌ CRITICAL: Admin routes not available:', error.message);
    console.error('Stack:', error.stack);
}

// Start the HTTP server
if (require.main === module) {
    app.listen(PORT, HOST, () => {
        console.log(`🚀 Server running on http://${HOST}:${PORT}`);
        console.log(`📊 Health check: http://${HOST}:${PORT}/healthz`);
    });
}

module.exports = { app };