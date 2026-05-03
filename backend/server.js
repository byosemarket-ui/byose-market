const path = require('path');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const HOST = '0.0.0.0';

app.use(cors({
    origin: '*'
}));
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