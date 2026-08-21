const config = require('../config/env');
const sqliteActivityRepository = require('./sqlite/activity.repository');
const sqliteCartRepository = require('./sqlite/cart.repository');
const sqliteCategoryRepository = require('./sqlite/category.repository');
const sqliteProductRepository = require('./sqlite/product.repository');
const sqliteOrderRepository = require('./sqlite/order.repository');
const sqliteReviewRepository = require('./sqlite/review.repository');
const sqliteSettingsRepository = require('./sqlite/settings.repository');
const sqliteStorefrontStateRepository = require('./sqlite/storefront-state.repository');
const sqliteUserRepository = require('./sqlite/user.repository');
const sqliteMessageRepository = require('./sqlite/message.repository');
const sqliteHeroSlideRepository = require('./sqlite/hero-slide.repository');
const sqliteAdminProfileRepository = require('./sqlite/admin-profile.repository');
const sqliteAdminSecurityRepository = require('./sqlite/admin-security.repository');
const sqliteAdminPasswordRepository = require('./sqlite/admin-password.repository');
const sqliteDeliveryZoneRepository = require('./sqlite/delivery-zone.repository');
const sqliteNotificationRepository = require('./sqlite/notification.repository');
const sqliteNotificationEmailDeliveryRepository = require('./sqlite/notification-email-delivery.repository');
const sqliteNotificationAutomationJobRepository = require('./sqlite/notification-automation-job.repository');
const sqliteNotificationOpsLogRepository = require('./sqlite/notification-ops-log.repository');
const sqliteNotificationChannelDeliveryRepository = require('./sqlite/notification-channel-delivery.repository');
const sqliteWishlistRepository = require('./sqlite/wishlist.repository');
const sqliteRecentlyViewedRepository = require('./sqlite/recently-viewed.repository');
const sqliteCouponRepository = require('./sqlite/coupon.repository');
const sqliteStoreRepository = require('./sqlite/store.repository');
const sqliteCustomerNotificationRepository = require('./sqlite/customer-notification.repository');
const sqliteInventoryMovementRepository = require('./sqlite/inventory-movement.repository');
const sqliteCustomerSessionRepository = require('./sqlite/customer-session.repository');
const sqliteCustomerAddressRepository = require('./sqlite/customer-address.repository');

const sqliteRepositories = {
    activity: sqliteActivityRepository,
    carts: sqliteCartRepository,
    categories: sqliteCategoryRepository,
    products: sqliteProductRepository,
    orders: sqliteOrderRepository,
    reviews: sqliteReviewRepository,
    settings: sqliteSettingsRepository,
    storefrontStates: sqliteStorefrontStateRepository,
    users: sqliteUserRepository,
    messages: sqliteMessageRepository,
    heroSlides: sqliteHeroSlideRepository,
    adminProfile: sqliteAdminProfileRepository,
    adminSecurity: sqliteAdminSecurityRepository,
    adminPassword: sqliteAdminPasswordRepository,
    deliveryZones: sqliteDeliveryZoneRepository,
    notifications: sqliteNotificationRepository,
    notificationEmailDeliveries: sqliteNotificationEmailDeliveryRepository,
    notificationAutomationJobs: sqliteNotificationAutomationJobRepository,
    notificationOpsLogs: sqliteNotificationOpsLogRepository,
    notificationChannelDeliveries: sqliteNotificationChannelDeliveryRepository,
    wishlist: sqliteWishlistRepository,
    recentlyViewed: sqliteRecentlyViewedRepository,
    coupons: sqliteCouponRepository,
    stores: sqliteStoreRepository,
    customerNotifications: sqliteCustomerNotificationRepository,
    inventoryMovements: sqliteInventoryMovementRepository,
    customerSessions: sqliteCustomerSessionRepository,
    customerAddresses: sqliteCustomerAddressRepository
};

function getRepositoryBundle() {
    if (config.databaseClient === 'sqlite') {
        return sqliteRepositories;
    }

    throw new Error(
        `Repository bundle is only available for DB_CLIENT=sqlite (received "${config.databaseClient}"). ` +
        'Mongo repositories are not implemented; set DB_CLIENT=sqlite or implement a mongo repository bundle.'
    );
}

module.exports = {
    getRepositoryBundle,
    repositoryProvider: config.databaseClient,
    sqliteRepositories
};