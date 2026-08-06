export const ROUTES = {
  dashboard: { key: "dashboard", label: "Dashboard", icon: "grid", path: "#/dashboard" },
  enterprise: { key: "enterprise", label: "Enterprise", icon: "chart", path: "#/enterprise" },
  orders: { key: "orders", label: "Orders", icon: "cart", path: "#/orders" },
  customers: { key: "customers", label: "Customers", icon: "users", path: "#/customers" },
  products: { key: "products", label: "Products", icon: "box", path: "#/products" },
  analytics: { key: "analytics", label: "Analytics", icon: "chart", path: "#/analytics" },
  inventory: { key: "inventory", label: "Inventory", icon: "layers", path: "#/inventory" },
  activity: { key: "activity", label: "Activity Logs", icon: "activity", path: "#/activity" },
  settings: { key: "settings", label: "Settings", icon: "settings", path: "#/settings" },
  heroslider: { key: "heroslider", label: "Hero Slider", icon: "website", path: "#/heroslider" }
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
  ROUTES.settings,
  ROUTES.heroslider
];

export const DEFAULT_ROUTE_KEY = ROUTES.dashboard.key;
export const LAST_ROUTE_STORAGE_KEY = "byose_admin_last_route_v2";
