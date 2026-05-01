require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const connectDB = require('./config/db');
const adminCustomerRoutes = require('./routes/admincustomers');
const adminOrderRoutes = require('./routes/adminorders');
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const cartRoutes = require('./routes/cart');
const orderRoutes = require('./routes/orders');

const app = express();
const projectRoot = path.resolve(__dirname, '..');

function getCorsOptions() {
    const configuredOrigins = String(process.env.CORS_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

    if (!configuredOrigins.length) {
        return {};
    }

    return {
        origin(origin, callback) {
            if (!origin || configuredOrigins.includes(origin)) {
                return callback(null, true);
            }

            return callback(new Error('Origin not allowed by CORS'));
        }
    };
}

app.use(cors(getCorsOptions()));
app.use(bodyParser.json());

// Connect to database
// ROUTES
app.use('/api/admin/customers', adminCustomerRoutes);
app.use('/api/admin/orders', adminOrderRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use(express.static(projectRoot));

// TEST
app.get('/', (req, res) => {
    res.send('API Running...');
});

// START SERVER
const PORT = process.env.PORT || 3000;

async function startServer() {
    await connectDB();

    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

startServer().catch((error) => {
    console.error('Server startup failed:', error);
    process.exit(1);
});