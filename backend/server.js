const path = require('path');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 5000;

const corsOptions = {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());

app.get('/', (_req, res) => {
    res.json({ status: 'ok', message: 'Byose Market Admin API is running' });
});

app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
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
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = { app };