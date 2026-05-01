const path = require('path');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const adminRoutes = require('./routes/adminRoutes');

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const HOST = String(process.env.HOST || '0.0.0.0').trim() || '0.0.0.0';

// CORS: allow all origins in development; restrict when CORS_ORIGINS is set
function getCorsOptions() {
    const configuredOrigins = String(process.env.CORS_ORIGINS || '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);

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
        return { origin: true, credentials: false };
    }

    return {
        origin(origin, callback) {
            if (!origin || configuredOrigins.some((configuredOrigin) => matchesConfiguredOrigin(configuredOrigin, origin))) {
                return callback(null, true);
            }
            return callback(new Error('Origin not allowed by CORS'));
        },
        credentials: false
    };
}

app.use(cors(getCorsOptions()));
app.use(express.json());

app.get('/', (_req, res) => {
    res.json({ status: 'ok', message: 'Byose Market Admin API is running' });
});

app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
});

app.use('/api/admin', adminRoutes);

// Start the HTTP server immediately — no database required for admin login
if (require.main === module) {
    app.listen(PORT, HOST, () => {
        console.log(`Admin API server running on http://${HOST}:${PORT}`);
        console.log(`Health endpoint: http://${HOST}:${PORT}/healthz`);
        console.log(`Login endpoint: POST http://${HOST}:${PORT}/api/admin/login`);
    });
}

module.exports = { app };