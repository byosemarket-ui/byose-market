export const ROUTES = {
  dashboard: { key: "dashboard", label: "Dashboard", icon: "grid", path: "#/dashboard" },
  enterprise: { key: "enterprise", label: "Enterprise", icon: "chart", path: "#/enterprise" },
  orders: { key: "orders", label: "Orders", icon: "cart", path: "#/orders" },
  customers: { key: "customers", label: "Customers", icon: "users", path: "#/customers" },
  products: { key: "products", label: "Products", icon: "box", path: "#/products" },
  analytics: { key: "analytics", label: "Analytics", icon: "chart", path: "#/analytics" },
  inventory: { key: "inventory", label: "Inventory", icon: "layers", path: "#/inventory" },
  activity: { key: "activity", label: "Activity Logs", icon: "activity", path: "#/activity" },
  settings: { key: "settings", label: "Settings", icon: "settings", path: "#/settings" }
};

export const ROUTE_ORDER = [
  ROUTES.dashboard,
  ROUTES.enterprise,
  ROUTES.orders,
  ROUTES.customers,
  ROUTES.products,
  ROUTES.analytics,
  ROUTES.inventory,
  ROUTES.activity,
  ROUTES.settings
];

export const DEFAULT_ROUTE_KEY = ROUTES.dashboard.key;
export const LAST_ROUTE_STORAGE_KEY = "byose_admin_last_route_v2";

// ---------------------------------------------------------------------------
// FEATURE FLAGS
// ---------------------------------------------------------------------------
// Centralised feature toggles for enterprise capabilities. Toggle these flags
// to enable/disable features across the entire admin SPA without scattering
// conditional logic throughout individual page or service files.
//
// Convention:
//   FEATURE_<SYSTEM>_<CAPABILITY> = true | false
//
// Future integrations (payment gateways, shipping APIs, SMS, email, etc.)
// should each have a corresponding flag added here.
// ---------------------------------------------------------------------------

export const FEATURES = {
  // Realtime analytics sync (SSE / polling)
  REALTIME_SYNC: true,

  // Server-side CSV/PDF report exports
  SERVER_SIDE_EXPORTS: true,

  // Enterprise intelligence overview API
  ENTERPRISE_INTELLIGENCE: true,

  // ---- Future integration readiness (disabled until wired) ----------------

  // Email notification system (order confirmations, alerts)
  EMAIL_NOTIFICATIONS: false,

  // SMS/WhatsApp notifications (Africa's Talking or similar)
  SMS_NOTIFICATIONS: false,

  // Webhook event delivery to third-party systems
  WEBHOOK_DELIVERY: false,

  // Multi-admin session management
  MULTI_ADMIN: false,

  // Shipping carrier API integration (e.g. DHL, local courier)
  SHIPPING_INTEGRATION: false,

  // External payment gateway status polling (Stripe, MTN Mobile Money, etc.)
  PAYMENT_STATUS_POLLING: false,

  // Product review and rating system
  PRODUCT_REVIEWS: false
};

// ---------------------------------------------------------------------------
// PAGINATION DEFAULTS
// ---------------------------------------------------------------------------
// Consistent defaults shared across all admin list views.
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 200
};

// ---------------------------------------------------------------------------
// AUTO-REFRESH CONFIG
// ---------------------------------------------------------------------------
export const AUTO_REFRESH_INTERVAL_MS = 120_000;   // 2 minutes
export const REALTIME_SYNC_INTERVAL_MS = 25_000;   // 25 seconds
export const MIN_SYNC_REFRESH_DEBOUNCE_MS = 320;   // debounce for sync events
