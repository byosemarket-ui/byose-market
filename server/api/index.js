const express = require('express');
const requireDatabase = require('../middleware/requiredatabase');
const { createRateLimiter } = require('../middleware/ratelimiter');
const adminCustomerRoutes = require('../routes/admincustomers');
const adminCartRoutes = require('../routes/admincarts');
const adminDashboardRoutes = require('../routes/admindashboard');
const adminSettingsRoutes = require('../routes/adminsettings');
const adminProfileRoutes = require('../routes/adminprofile');
const adminSecurityRoutes = require('../routes/adminsecurity');
const adminPasswordRoutes = require('../routes/adminpassword');
const adminBrandingRoutes = require('../routes/adminbranding');
const adminDeliveryRoutes = require('../routes/admindelivery');
const adminPaymentRoutes = require('../routes/adminpayment');
const adminSeoRoutes = require('../routes/adminseo');
const adminNotificationRoutes = require('../routes/adminnotifications');
const adminMessageRoutes = require('../routes/adminmessages');
const adminOrderRoutes = require('../routes/adminorders');
const adminActivityRoutes = require('../routes/adminactivity');
const adminIntelligenceRoutes = require('../routes/adminintelligence');
const adminProductRoutes = require('../routes/adminproducts');
const adminHeroSlideRoutes = require('../routes/adminheroslides');
const adminAuthRoutes = require('../../admin/admin-login/admin.routes');
const activityRoutes = require('../routes/activity');
const realtimeRoutes = require('../routes/realtime');
const authRoutes = require('../routes/auth');
const messageRoutes = require('../routes/messages');
const productRoutes = require('../routes/products');
const heroSlideRoutes = require('../routes/heroslides');
const cartRoutes = require('../routes/cart');
const orderRoutes = require('../routes/orders');
const storefrontStateRoutes = require('../routes/storefrontstate');
const wishlistRoutes = require('../routes/wishlist');
const recentlyViewedRoutes = require('../routes/recentlyviewed');
const couponRoutes = require('../routes/coupons');
const favoriteStoresRoutes = require('../routes/favoritestores');
const storesRoutes = require('../routes/stores');
const customerNotificationRoutes = require('../routes/customernotifications');
const uploadRoutes = require('./routes/uploads');
const publicSettingsRoutes = require('../routes/publicsettings');
const invoiceRoutes = require('../routes/invoices');
const publicShippingRoutes = require('../routes/publicshipping');
const dpoPaymentRoutes = require('../routes/dpopayments');

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

function createApiRouter() {
    const router = express.Router();

    router.use('/admin', adminRateLimiter, adminAuthRoutes);
    router.use('/admin/customers', requireDatabase, adminCustomerRoutes);
    router.use('/admin/carts', requireDatabase, adminCartRoutes);
    router.use('/admin/dashboard', requireDatabase, adminDashboardRoutes);
    router.use('/admin/settings', requireDatabase, adminSettingsRoutes);
    router.use('/admin/profile', requireDatabase, adminProfileRoutes);
    router.use('/admin/security', requireDatabase, adminSecurityRoutes);
    router.use('/admin/password', requireDatabase, adminPasswordRoutes);
    router.use('/admin/branding', requireDatabase, adminBrandingRoutes);
    router.use('/admin/delivery', requireDatabase, adminDeliveryRoutes);
    router.use('/admin/payment', requireDatabase, adminPaymentRoutes);
    router.use('/admin/seo', requireDatabase, adminSeoRoutes);
    router.use('/admin/notifications', requireDatabase, adminNotificationRoutes);
    router.use('/admin/messages', requireDatabase, adminMessageRoutes);
    router.use('/admin/orders', requireDatabase, adminOrderRoutes);
    router.use('/admin/activity', requireDatabase, adminActivityRoutes);
    router.use('/admin/intelligence', requireDatabase, adminIntelligenceRoutes);
    router.use('/admin/products', requireDatabase, adminProductRoutes);
    router.use('/admin/hero-slides', requireDatabase, adminHeroSlideRoutes);
    router.use('/activity', requireDatabase, activityRoutes);
    router.use('/auth', authRateLimiter, authRoutes);
    router.use('/messages', requireDatabase, messageRoutes);
    router.use('/products', requireDatabase, productRoutes);
    router.use('/hero-slides', requireDatabase, heroSlideRoutes);
    router.use('/cart', requireDatabase, cartRoutes);
    router.use('/orders', requireDatabase, orderRoutes);
    router.use('/storefront/state', requireDatabase, storefrontStateRoutes);
    router.use('/wishlist', requireDatabase, wishlistRoutes);
    router.use('/recently-viewed', requireDatabase, recentlyViewedRoutes);
    router.use('/coupons', requireDatabase, couponRoutes);
    router.use('/favorite-stores', requireDatabase, favoriteStoresRoutes);
    router.use('/stores', requireDatabase, storesRoutes);
    router.use('/customer-notifications', requireDatabase, customerNotificationRoutes);
    router.use('/realtime', realtimeRateLimiter, realtimeRoutes);
    router.use('/settings', publicSettingsRoutes);
    router.use('/invoices', invoiceRoutes);
    router.use('/shipping', publicShippingRoutes);
    router.use('/payments/dpo', dpoPaymentRoutes);
    router.use('/uploads', uploadRoutes);

    router.use((_req, res) => {
        return res.status(404).json({
            success: false,
            code: 'API_ROUTE_NOT_FOUND',
            message: 'API route not found.'
        });
    });

    return router;
}

module.exports = createApiRouter;