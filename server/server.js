require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const connectDB = require('./config/db');
const { ensureAdminAccount } = require('./controllers/adminauthcontroller');
const adminAuthRoutes = require('./routes/adminauth');
const adminCustomerRoutes = require('./routes/admincustomers');
const adminOrderRoutes = require('./routes/adminorders');
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const cartRoutes = require('./routes/cart');
const orderRoutes = require('./routes/orders');

const app = express();
const projectRoot = path.resolve(__dirname, '..');

app.use(cors());
app.use(bodyParser.json());

// Connect to database
// ROUTES
app.use('/api/admin', adminAuthRoutes);
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
    await ensureAdminAccount();

    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

startServer().catch((error) => {
    console.error('Server startup failed:', error);
    process.exit(1);
});