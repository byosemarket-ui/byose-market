import { ROUTES } from "./constants.js";

function routeHref(routeKey, query = "") {
  return `${ROUTES[routeKey].path}${query}`;
}

function routeLink(id, label, routeKey, options = {}) {
  const query = options.query || "";
  return {
    id,
    label,
    href: routeHref(routeKey, query),
    description: options.description || "",
    matchRoutes: options.matchRoutes || [routeKey],
    matchHashes: options.matchHashes || [routeHref(routeKey, query)]
  };
}

function externalLink(id, label, href, options = {}) {
  const normalizedPath = String(options.matchPath || href).replace(/^\.\//, "").replace(/^\/+/, "");
  return {
    id,
    label,
    href,
    description: options.description || "",
    matchPaths: options.matchPaths || [normalizedPath]
  };
}

function actionItem(id, label, action, options = {}) {
  return {
    id,
    label,
    action,
    description: options.description || ""
  };
}

function countDestinations(entries) {
  return entries.reduce((total, entry) => {
    const childEntries = Array.isArray(entry.children) ? entry.children : [];
    return total + childEntries.length + countDestinations(childEntries);
  }, 0);
}

export const ADMIN_NAVIGATION = [
  {
    id: "operations",
    label: "Core Operations",
    items: [
      {
        id: "dashboard",
        label: "Dashboard",
        icon: "grid",
        routeKey: ROUTES.dashboard.key,
        description: "Overview, statistics, and quick executive analytics.",
        children: [
          routeLink("dashboard-overview", "Overview", "dashboard", { description: "Your business performance and operational overview." }),
          routeLink("dashboard-statistics", "Statistics", "dashboard", { query: "?panel=statistics", description: "Detailed revenue, order, customer and product performance." }),
          routeLink("dashboard-quick-analytics", "Quick Analytics", "dashboard", { query: "?panel=quick-analytics", description: "Fast business insights and actions." }),
          routeLink("dashboard-enterprise", "Enterprise Console", "enterprise", { description: "Operational and system control center." })
        ]
      },
      {
        id: "products",
        label: "Products",
        icon: "box",
        routeKey: ROUTES.products.key,
        description: "Catalog, inventory, reviews, and featured merchandising.",
        children: [
          routeLink("products-all", "All Products", "products", { description: "SPA catalog management surface." }),
          routeLink("products-add", "Add Product", "products", { query: "?view=create&step=info", description: "Create a new storefront product." }),
          externalLink("products-categories", "Categories", "categories/index.html", { description: "Catalog structure and category management." }),
          routeLink("products-inventory", "Inventory", "inventory", { description: "Stock position and replenishment signals." }),
          externalLink("products-reviews", "Product Reviews", "reviews/index.html", { description: "Moderate and inspect product reviews." }),
          externalLink("products-featured", "Featured Products", "homepage/featured.html", { description: "Manage promoted and featured product placements." }),
          externalLink("products-media", "Media Library", "media/index.html", { description: "Detected shared asset library for product content." })
        ]
      },
      {
        id: "orders",
        label: "Orders",
        icon: "cart",
        routeKey: ROUTES.orders.key,
        description: "Order flow, fulfillment status, and returns handling.",
        children: [
          routeLink("orders-all", "All Orders", "orders", { description: "Full centralized order view." }),
          routeLink("orders-pending", "Pending Orders", "orders", { query: "?status=pending", description: "Orders awaiting action." }),
          routeLink("orders-paid", "Paid Orders", "orders", { query: "?status=paid", description: "Orders whose payment was completed successfully." }),
          routeLink("orders-cod", "COD / Pay on Delivery", "orders", { query: "?status=cod", description: "Orders placed with Pay on Delivery." }),
          routeLink("orders-completed", "Completed Orders", "orders", { query: "?status=completed", description: "Orders that finished fulfillment." }),
          routeLink("orders-cancelled", "Cancelled Orders", "orders", { query: "?status=cancelled", description: "Cancelled order monitoring." }),
          routeLink("orders-returns", "Returns & Refunds", "orders", { query: "?status=returns", description: "Returns and refund workflow staging." })
        ]
      },
      {
        id: "customers",
        label: "Customers",
        icon: "users",
        routeKey: ROUTES.customers.key,
        description: "Customer accounts, activity, and messaging context.",
        children: [
          routeLink("customers-all", "All Customers", "customers", { description: "Centralized customer directory." }),
          routeLink("customers-activity", "Customer Activity", "activity", { query: "?scope=customers", description: "Customer-linked operational activity." }),
          externalLink("customers-messages", "Customer Messages", "messages/index.html", { description: "Inbox and conversation management." }),
          externalLink("customers-accounts", "Customer Accounts", "customers/profile.html", { description: "Detected customer account/profile page." })
        ]
      }
    ]
  },
  {
    id: "growth",
    label: "Growth & Content",
    items: [
      {
        id: "sales-analytics",
        label: "Sales & Analytics",
        icon: "chart",
        routeKey: ROUTES.analytics.key,
        description: "Revenue, traffic, conversion, and performance analysis.",
        children: [
          routeLink("analytics-revenue", "Revenue", "analytics", { description: "Top-line revenue performance." }),
          routeLink("analytics-weekly", "Weekly Sales", "analytics", { query: "?view=weekly", description: "Weekly sales breakdown." }),
          routeLink("analytics-monthly", "Monthly Sales", "analytics", { query: "?view=monthly", description: "Monthly revenue analysis." }),
          routeLink("analytics-visits", "Visits", "analytics", { query: "?metric=visits", description: "Traffic and visit volume." }),
          routeLink("analytics-conversion", "Conversion Rate", "analytics", { query: "?metric=conversion", description: "Conversion monitoring." }),
          routeLink("analytics-traffic", "Traffic Graphs", "analytics", { query: "?panel=traffic", description: "Traffic and performance graph focus." }),
          routeLink("analytics-activity", "Activity Logs", "activity", { description: "Realtime diagnostics and operational logs." })
        ]
      },
      {
        id: "website-management",
        label: "Website Management",
        icon: "website",
        routeKey: ROUTES.heroslider.key,
        description: "Homepage content, promotions, banners, and storefront settings.",
        children: [
          externalLink("website-homepage", "Homepage Control", "homepage/index.html", { description: "Detected homepage control surface." }),
          externalLink("website-banners", "Banners", "homepage/banners.html", { description: "Homepage banner management." }),
          routeLink("website-hero-slider", "Hero Slider", "heroslider", { description: "Manage homepage hero slider slides and storefront highlights." }),
          externalLink("website-promotions", "Promotions", "homepage/featured.html", { description: "Featured blocks and promotional content." }),
          externalLink("website-store-settings", "Store Settings", "settings/index.html", { description: "Detected storefront settings entry." }),
          routeLink("website-payment-management", "Payment Management", "settings", {
            query: "?panel=payment",
            description: "DPO Pay LIVE production control, encrypted credentials, and checkout status."
          }),
          externalLink("website-media", "Media Assets", "media/upload.html", { description: "Detected upload workflow for site assets." })
        ]
      },
      {
        id: "messages-notifications",
        label: "Messages & Notifications",
        icon: "messages",
        routeKey: ROUTES.activity.key,
        description: "Inbox, contact requests, and notification visibility.",
        children: [
          externalLink("messages-customer", "Customer Messages", "messages/index.html", { description: "Inbox and customer message list." }),
          externalLink("messages-contact", "Contact Requests", "messages/details.html", { description: "Detected message detail/contact workflow." }),
          routeLink("messages-notifications", "Notification History", "notifications", { description: "Search, filter, and manage the full notification history." }),
          routeLink("messages-notification-monitoring", "Notification Monitoring", "notificationmonitoring", { description: "Health, delivery metrics, recovery, and operations logs for the notification system." }),
          routeLink("messages-notification-analytics", "Analytics & Reports", "notificationanalytics", { description: "Notification volume, delivery performance, and exportable reports." }),
          routeLink("messages-activity", "Activity Logs", "activity", { description: "System activity and audit stream." })
        ]
      }
    ]
  },
  {
    id: "administration",
    label: "Administration",
    items: [
      {
        id: "admin-settings",
        label: "Admin Settings",
        icon: "settings",
        routeKey: ROUTES.settings.key,
        description: "Profile, security, password, and operational configuration.",
        children: [
          routeLink("settings-profile", "Admin Profile", "settings", { query: "?panel=profile", description: "Administrator profile and workspace identity." }),
          routeLink("settings-security", "Security", "settings", { query: "?panel=security", description: "Access and session security controls." }),
          routeLink("settings-password", "Password", "settings", { query: "?panel=password", description: "Password and credential management." }),
          routeLink("settings-general", "General", "settings", { query: "?panel=general", description: "Platform store, regional, and system configuration." }),
          routeLink("settings-branding", "Branding", "settings", { query: "?panel=branding", description: "Logos, colors, icons, and brand identity." }),
          routeLink("settings-delivery", "Delivery", "settings", { query: "?panel=delivery", description: "Delivery zones, fees, methods, and timing." }),
          routeLink("settings-payment", "Payment Management", "settings", { query: "?panel=payment", description: "DPO Pay LIVE production control, encrypted credentials, and checkout status." }),
          routeLink("settings-seo", "SEO", "settings", { query: "?panel=seo", description: "Website SEO, social cards, analytics, and structured data." }),
          routeLink("settings-notifications", "Notifications", "settings", { query: "?panel=notifications", description: "Admin alert email, email/browser/sound notification preferences." }),
          routeLink("settings-logout", "Logout & Sessions", "settings", { query: "?panel=logout", description: "Active sessions, secure logout, expiration, and audit trail." })
        ]
      }
    ]
  }
];

export const NAVIGATION_CATEGORY_TOTAL = ADMIN_NAVIGATION.reduce((count, group) => count + group.items.length, 0);
export const NAVIGATION_DESTINATION_TOTAL = ADMIN_NAVIGATION.reduce((count, group) => count + countDestinations(group.items), 0);

export const ROUTE_METADATA = ADMIN_NAVIGATION.reduce((metadata, group) => {
  group.items.forEach((item) => {
    if (!item.routeKey) {
      return;
    }

    metadata[item.routeKey] = {
      title: ROUTES[item.routeKey]?.label || item.label,
      description: item.description,
      section: item.label,
      group: group.label
    };
  });

  return metadata;
}, {});