const path = require('path');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const adminRoutes = require('./routes/adminRoutes');

const app = express();
const PORT = Number(process.env.PORT) || 5000;

// CORS: allow all origins in development; restrict when CORS_ORIGINS is set
function getCorsOptions() {
    const configuredOrigins = String(process.env.CORS_ORIGINS || '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);

    if (!configuredOrigins.length) {
        return { origin: true, credentials: false };
    }

    return {
        origin(origin, callback) {
            if (!origin || configuredOrigins.includes(origin)) {
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

app.use('/api/admin', adminRoutes);

// Start the HTTP server immediately — no database required for admin login
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Admin API server running on http://localhost:${PORT}`);
        console.log(`Login endpoint: POST http://localhost:${PORT}/api/admin/login`);
    });
}

module.exports = { app };