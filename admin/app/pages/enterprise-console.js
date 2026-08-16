import { escapeHtml, formatDate } from "../components/ui.js";

const LOW_STOCK_THRESHOLD = 5;
const ACTIVITY_LIMIT = 12;
const EVENT_LIMIT = 10;
const NOTIFICATION_LIMIT = 6;

export const ACTIVITY_FILTERS = [
  { key: "all", label: "All" },
  { key: "orders", label: "Orders" },
  { key: "products", label: "Products" },
  { key: "inventory", label: "Inventory" },
  { key: "users", label: "Users" },
  { key: "system", label: "System" }
];

const ADMIN_ACTIONS = [
  { href: "#/orders", title: "Manage Orders", note: "Fulfillment and status" },
  { href: "#/products", title: "Manage Products", note: "Catalog and pricing" },
  { href: "#/inventory", title: "Manage Inventory", note: "Stock and replenishment" },
  { href: "#/customers", title: "Manage Customers", note: "Customer directory" },
  { href: "#/dashboard?panel=statistics", title: "View Reports", note: "Period analytics" },
  { href: "#/settings", title: "Settings", note: "Admin preferences" },
  { href: "#/notifications", title: "Notifications", note: "Inbox and history" },
  { href: "#/activity", title: "Activity Logs", note: "Operational events" },
  { href: "#/notificationmonitoring", title: "Notification Ops", note: "Delivery health" },
  { href: "#/products?view=create&step=info", title: "Add Product", note: "Create a catalog item" }
];

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatNumber(value) {
  return asNumber(value).toLocaleString("en-US");
}

function isActiveCatalogProduct(product) {
  const status = String(product?.status || "active").toLowerCase();
  return status !== "inactive" && status !== "draft" && status !== "archived" && status !== "hidden";
}

function isPendingFulfillment(order) {
  const value = String(order?.status || order?.orderStatus || "").toLowerCase();
  return value.includes("pending") || value.includes("process") || value.includes("confirm") || value.includes("pack");
}

function isPendingOrder(order) {
  return String(order?.status || order?.orderStatus || "").toLowerCase().includes("pending");
}

function isProcessingOrder(order) {
  const value = String(order?.status || order?.orderStatus || "").toLowerCase();
  return value.includes("process") || value.includes("confirm") || value.includes("pack") || value.includes("ship");
}

function isOpenMessage(message) {
  const status = String(message?.status || "").toLowerCase();
  return status && !status.includes("resolv") && !status.includes("review") && !status.includes("closed") && !status.includes("archiv");
}

function formatRelativeTime(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) {
    return "";
  }

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) {
    return formatDate(value);
  }

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDate(value);
}

function formatClock(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) {
    return "";
  }
  return date.toLocaleString();
}

function haystack(entry) {
  return [
    entry?.event,
    entry?.type,
    entry?.eventType,
    entry?.category,
    entry?.path,
    entry?.summary,
    entry?.title,
    entry?.action,
    entry?.object
  ].map((value) => String(value || "").toLowerCase()).join(" ");
}

function classifyActivityBucket(entry) {
  const text = haystack(entry);
  if (text.includes("order") || text.includes("payment") || text.includes("refund") || text.includes("fulfill")) return "orders";
  if (text.includes("invent") || text.includes("stock")) return "inventory";
  if (text.includes("product") || text.includes("catalog") || text.includes("sku")) return "products";
  if (text.includes("user") || text.includes("customer") || text.includes("login") || text.includes("session") || text.includes("auth") || text.includes("admin")) return "users";
  return "system";
}

function matchesActivityFilter(entry, filter) {
  if (!filter || filter === "all") return true;
  return classifyActivityBucket(entry) === filter;
}

function humanizeToken(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function mapHealthCode(code) {
  const value = String(code || "").toLowerCase();
  if (value === "healthy" || value === "ok" || value === "online" || value === "ready") return "online";
  if (value === "warning" || value === "degraded" || value === "partial") return "degraded";
  if (value === "error" || value === "offline" || value === "failed" || value === "down" || value === "not-ready") return "offline";
  return "unknown";
}

function buildService(id, name, status, explanation, lastChecked) {
  const normalized = String(status || "unknown").toLowerCase();
  const safeStatus = ["online", "degraded", "offline", "unknown"].includes(normalized) ? normalized : "unknown";
  return {
    id,
    name,
    status: safeStatus,
    label: safeStatus.toUpperCase(),
    explanation: explanation || (safeStatus === "unknown" ? "Not available" : ""),
    lastChecked: lastChecked || ""
  };
}

function readSessionStatus(session) {
  const snapshot = asObject(session);
  if (!snapshot.checked) {
    return buildService("auth", "Authentication", "unknown", "Session status could not be read.");
  }

  if (snapshot.jwtProtected) {
    return buildService("auth", "Authentication", "online", snapshot.detail || "JWT session is active.");
  }
  if (snapshot.authenticated) {
    return buildService("auth", "Authentication", "degraded", snapshot.detail || "Session is active but a JWT token is not available.");
  }
  return buildService("auth", "Authentication", "offline", snapshot.detail || "Sign-in is required.");
}

function buildSystemServices(payload) {
  const ping = asObject(payload?.ping);
  const healthz = asObject(payload?.healthz);
  const notifHealth = asObject(payload?.notificationHealth);
  const sessionService = readSessionStatus(payload?.session);

  let apiService;
  if (payload?.pingFailed) {
    if (payload?.dashboardFailed) {
      apiService = buildService("api", "API", "offline", payload?.pingError || "Realtime ping and dashboard API did not respond.", ping.checkedAt);
    } else if (payload?.dashboard) {
      apiService = buildService("api", "API", "degraded", "Realtime ping failed; the dashboard API responded.", ping.checkedAt);
    } else {
      apiService = buildService("api", "API", "offline", payload?.pingError || "Realtime ping failed.", ping.checkedAt);
    }
  } else if (ping.ok) {
    apiService = buildService("api", "API", "online", "Realtime ping succeeded.", ping.checkedAt || ping.timestamp);
  } else {
    apiService = buildService("api", "API", "unknown", "API connectivity was not verified.");
  }

  let backendService;
  let databaseService;
  if (payload?.healthzFailed) {
    backendService = buildService("backend", "Backend", "unknown", "Backend health endpoint is not available.");
    databaseService = buildService("database", "Database", "unknown", "Database status is not available.");
  } else if (healthz.checked) {
    const backendStatus = mapHealthCode(healthz.status);
    backendService = buildService(
      "backend",
      "Backend",
      backendStatus === "unknown" ? (healthz.ok ? "online" : "unknown") : backendStatus,
      healthz.status ? `Health endpoint reported ${healthz.status}.` : "Health endpoint responded.",
      healthz.checkedAt
    );
    if (typeof healthz.dbConnected === "boolean") {
      databaseService = buildService(
        "database",
        "Database",
        healthz.dbConnected ? "online" : "offline",
        healthz.dbConnected ? "Database connection is ready." : "Database connection is not ready.",
        healthz.checkedAt
      );
    } else {
      databaseService = buildService("database", "Database", "unknown", "Database status is not available.", healthz.checkedAt);
    }
  } else {
    backendService = buildService("backend", "Backend", "unknown", "Backend health endpoint is not available.");
    databaseService = buildService("database", "Database", "unknown", "Database status is not available.");
  }

  let notificationService;
  if (payload?.notificationHealthFailed) {
    notificationService = buildService(
      "notifications",
      "Notifications",
      "offline",
      payload?.notificationHealthError || "Unable to retrieve notification health status.",
      ""
    );
  } else if (notifHealth.overall) {
    const status = mapHealthCode(notifHealth.overall.code || notifHealth.overall.label);
    notificationService = buildService(
      "notifications",
      "Notifications",
      status,
      notifHealth.overall.label ? `Monitoring reported ${notifHealth.overall.label}.` : "Notification monitoring responded.",
      notifHealth.checkedAt
    );
  } else {
    notificationService = buildService("notifications", "Notifications", "unknown", "Notification health is not available.");
  }

  let networkService;
  if (payload?.session && typeof payload.session.online === "boolean") {
    networkService = buildService(
      "network",
      "Browser network",
      payload.session.online ? "online" : "offline",
      payload.session.online ? "The browser reports an active network connection." : "The browser reports no network connection."
    );
  } else {
    networkService = buildService("network", "Browser network", "unknown", "Browser connectivity was not verified.");
  }

  return [sessionService, apiService, backendService, databaseService, notificationService, networkService];
}

function summarizeSystem(services) {
  const verified = services.filter((service) => service.status !== "unknown");
  const offline = verified.filter((service) => service.status === "offline").length;
  const degraded = verified.filter((service) => service.status === "degraded").length;
  const unknown = services.filter((service) => service.status === "unknown").length;

  if (!verified.length) {
    return {
      key: "unknown",
      label: "STATUS UNKNOWN",
      detail: "No system service could be verified from available checks."
    };
  }

  if (offline) {
    return {
      key: "attention",
      label: "ATTENTION REQUIRED",
      detail: `${offline} verified service${offline === 1 ? "" : "s"} ${offline === 1 ? "is" : "are"} offline.`
    };
  }

  if (degraded) {
    return {
      key: "partial",
      label: "PARTIAL SERVICE ISSUE",
      detail: `${degraded} verified service${degraded === 1 ? "" : "s"} ${degraded === 1 ? "is" : "are"} degraded.`
    };
  }

  if (unknown) {
    return {
      key: "operational",
      label: "SYSTEM OPERATIONAL",
      detail: `Verified services are online. ${unknown} service${unknown === 1 ? "" : "s"} could not be verified.`
    };
  }

  return {
    key: "operational",
    label: "SYSTEM OPERATIONAL",
    detail: "Verified services are online."
  };
}

function countBy(list, predicate) {
  return asList(list).reduce((total, item) => total + (predicate(item) ? 1 : 0), 0);
}

function buildOperationalHealth(payload) {
  const ordersFailed = Boolean(payload?.ordersFailed);
  const productsFailed = Boolean(payload?.productsFailed);
  const messagesFailed = Boolean(payload?.messagesFailed);
  const orders = asList(payload?.orders);
  const products = asList(payload?.products).filter(isActiveCatalogProduct);
  const messages = asList(payload?.messages);

  const pendingOrders = ordersFailed ? null : countBy(orders, isPendingOrder);
  const processingOrders = ordersFailed ? null : countBy(orders, isProcessingOrder);
  const awaitingAction = ordersFailed ? null : countBy(orders, isPendingFulfillment);
  const outOfStock = productsFailed ? null : countBy(products, (product) => asNumber(product?.stock) <= 0);
  const lowStock = productsFailed ? null : countBy(products, (product) => asNumber(product?.stock) > 0 && asNumber(product?.stock) <= LOW_STOCK_THRESHOLD);
  const openMessages = messagesFailed ? null : countBy(messages, isOpenMessage);

  const attention = [];
  if (awaitingAction) attention.push(`${formatNumber(awaitingAction)} order${awaitingAction === 1 ? "" : "s"} awaiting action`);
  if (outOfStock) attention.push(`${formatNumber(outOfStock)} out of stock`);
  if (lowStock) attention.push(`${formatNumber(lowStock)} low stock`);
  if (openMessages) attention.push(`${formatNumber(openMessages)} open message${openMessages === 1 ? "" : "s"}`);

  let tone = "ok";
  let label = "Operations stable";
  if (ordersFailed && productsFailed) {
    tone = "error";
    label = "Operational data unavailable";
  } else if ((outOfStock && outOfStock > 0) || (awaitingAction && awaitingAction > 8)) {
    tone = "critical";
    label = "Operational attention needed";
  } else if ((lowStock && lowStock > 0) || (awaitingAction && awaitingAction > 0) || (openMessages && openMessages > 0)) {
    tone = "warn";
    label = "Operational follow-up needed";
  }

  return {
    ordersFailed,
    productsFailed,
    messagesFailed,
    ordersError: payload?.ordersError || "Unable to retrieve order operational status.",
    productsError: payload?.productsError || "Unable to retrieve inventory operational status.",
    pendingOrders,
    processingOrders,
    awaitingAction,
    outOfStock,
    lowStock,
    openMessages,
    lowStockThreshold: LOW_STOCK_THRESHOLD,
    attention,
    tone,
    label
  };
}

function pushAlert(alerts, alert) {
  if (!alert?.title) return;
  alerts.push(alert);
}

function buildAlerts(payload, services, operational) {
  const alerts = [];
  const offlineServices = services.filter((service) => service.status === "offline");
  const degradedServices = services.filter((service) => service.status === "degraded");

  offlineServices.forEach((service) => {
    pushAlert(alerts, {
      severity: "critical",
      title: `${service.name} is offline`,
      description: service.explanation || "This service did not respond to a live check.",
      href: "#/enterprise",
      action: "Review console",
      timestamp: service.lastChecked || payload?.refreshedAt || ""
    });
  });

  degradedServices.forEach((service) => {
    pushAlert(alerts, {
      severity: "warning",
      title: `${service.name} is degraded`,
      description: service.explanation || "This service responded with a degraded state.",
      href: "#/enterprise",
      action: "Review console",
      timestamp: service.lastChecked || payload?.refreshedAt || ""
    });
  });

  if (!operational.ordersFailed && operational.awaitingAction > 0) {
    pushAlert(alerts, {
      severity: operational.awaitingAction > 8 ? "critical" : "warning",
      title: "Orders awaiting action",
      description: `${formatNumber(operational.awaitingAction)} order${operational.awaitingAction === 1 ? "" : "s"} are pending, processing, confirmed, or packing.`,
      href: "#/orders?status=pending",
      action: "View Orders",
      reference: `${formatNumber(operational.awaitingAction)} orders`,
      timestamp: payload?.refreshedAt || ""
    });
  }

  if (!operational.productsFailed && operational.outOfStock > 0) {
    pushAlert(alerts, {
      severity: "critical",
      title: "Out of stock products",
      description: `${formatNumber(operational.outOfStock)} catalog product${operational.outOfStock === 1 ? "" : "s"} currently have no stock.`,
      href: "#/inventory",
      action: "View Inventory",
      reference: `${formatNumber(operational.outOfStock)} products`,
      timestamp: payload?.refreshedAt || ""
    });
  }

  if (!operational.productsFailed && operational.lowStock > 0) {
    pushAlert(alerts, {
      severity: "warning",
      title: "Low stock",
      description: `${formatNumber(operational.lowStock)} product${operational.lowStock === 1 ? "" : "s"} are at or below ${LOW_STOCK_THRESHOLD} units.`,
      href: "#/inventory",
      action: "View Inventory",
      reference: `${formatNumber(operational.lowStock)} products`,
      timestamp: payload?.refreshedAt || ""
    });
  }

  if (!operational.messagesFailed && operational.openMessages > 0) {
    pushAlert(alerts, {
      severity: "info",
      title: "Open customer messages",
      description: `${formatNumber(operational.openMessages)} message${operational.openMessages === 1 ? "" : "s"} still need review.`,
      href: "#/enterprise",
      action: "Review lookup",
      timestamp: payload?.refreshedAt || ""
    });
  }

  const notifications = asList(payload?.notifications?.notifications);
  const unread = asNumber(payload?.notifications?.unreadCount);
  const highPriority = notifications.filter((item) => String(item?.priority || "").toLowerCase() === "high" && String(item?.status || "").toLowerCase() !== "archived");
  if (!payload?.notificationsFailed && highPriority.length) {
    pushAlert(alerts, {
      severity: "warning",
      title: "High-priority notifications",
      description: `${formatNumber(highPriority.length)} high-priority notification${highPriority.length === 1 ? "" : "s"} require review.`,
      href: "#/notifications",
      action: "View Notifications",
      timestamp: highPriority[0]?.createdAt || payload?.refreshedAt || ""
    });
  } else if (!payload?.notificationsFailed && unread > 0) {
    pushAlert(alerts, {
      severity: "info",
      title: "Unread notifications",
      description: `${formatNumber(unread)} unread notification${unread === 1 ? "" : "s"} in the admin inbox.`,
      href: "#/notifications",
      action: "View Notifications",
      timestamp: payload?.refreshedAt || ""
    });
  }

  if (payload?.ordersFailed) {
    pushAlert(alerts, {
      severity: "warning",
      title: "Order operations unavailable",
      description: payload?.ordersError || "Unable to retrieve order operational status.",
      href: "#/orders",
      action: "Open Orders"
    });
  }

  if (payload?.productsFailed) {
    pushAlert(alerts, {
      severity: "warning",
      title: "Inventory operations unavailable",
      description: payload?.productsError || "Unable to retrieve inventory operational status.",
      href: "#/inventory",
      action: "Open Inventory"
    });
  }

  const rank = { critical: 0, warning: 1, info: 2, success: 3 };
  return alerts.sort((left, right) => (rank[left.severity] ?? 9) - (rank[right.severity] ?? 9));
}

function sanitizeActor(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/password|token|secret|bearer\s+[a-z0-9\-._~+/]+=*/i.test(text)) return "";
  return text;
}

function mapSecurityEvent(event) {
  const item = asObject(event);
  const eventType = String(item.eventType || item.type || "admin_event").trim();
  return {
    id: String(item.id || `${eventType}-${item.createdAt || ""}`),
    actor: sanitizeActor(item.adminEmail) || "Administrator",
    action: item.summary || humanizeToken(eventType) || "Admin event",
    object: humanizeToken(item.category || eventType),
    eventType,
    timestamp: item.createdAt || "",
    bucket: classifyActivityBucket(item),
    source: "admin"
  };
}

function mapActivityEntry(entry) {
  const item = asObject(entry);
  const eventType = String(item.event || item.type || "activity").trim();
  const object = item.path || item.city || item.device || "";
  return {
    id: String(item.id || `${eventType}-${item.createdAt || item.timestamp || ""}`),
    actor: item.device ? `Visitor · ${item.device}` : "System",
    action: humanizeToken(eventType) || "Activity",
    object,
    eventType,
    timestamp: item.createdAt || item.timestamp || "",
    bucket: classifyActivityBucket(item),
    source: "activity"
  };
}

function buildAdminActivity(payload, filter) {
  if (payload?.securityEventsFailed && payload?.activityFailed) {
    return {
      failed: true,
      error: payload?.securityEventsError || payload?.activityError || "Unable to retrieve admin activity.",
      items: [],
      filter
    };
  }

  const securityItems = asList(payload?.securityEvents?.items || payload?.securityEvents).map(mapSecurityEvent);
  const activityItems = payload?.securityEventsFailed || !securityItems.length
    ? asList(payload?.activity).map(mapActivityEntry)
    : [];
  const merged = (securityItems.length ? securityItems : activityItems)
    .filter((item) => matchesActivityFilter(item, filter))
    .sort((left, right) => new Date(right.timestamp || 0).getTime() - new Date(left.timestamp || 0).getTime())
    .slice(0, ACTIVITY_LIMIT);

  return {
    failed: false,
    unavailable: !securityItems.length && Boolean(payload?.activityFailed) && !activityItems.length,
    items: merged,
    filter,
    source: securityItems.length ? "admin-security" : "activity"
  };
}

function isSystemEvent(entry) {
  const text = haystack(entry);
  const level = String(entry?.level || entry?.status || "").toLowerCase();
  return level === "error" || level === "warning" || /error|fail|denied|offline|degrad|timeout|recover/.test(text);
}

function mapOpsLog(entry) {
  const item = asObject(entry);
  return {
    id: String(item.id || `${item.eventType || "event"}-${item.createdAt || ""}`),
    title: humanizeToken(item.eventType || item.status || "System event"),
    description: String(item.message || "").trim() || "Notification operations event.",
    timestamp: item.createdAt || "",
    tone: String(item.status || "info").toLowerCase()
  };
}

function buildSystemEvents(payload, services) {
  const events = [];

  asList(payload?.opsLogs?.logs || payload?.opsLogs).forEach((entry) => {
    events.push(mapOpsLog(entry));
  });

  asList(payload?.activity).filter(isSystemEvent).forEach((entry) => {
    events.push({
      id: String(entry.id || `${entry.event || "activity"}-${entry.createdAt || ""}`),
      title: humanizeToken(entry.event || entry.type || "Activity"),
      description: [entry.path, entry.level].filter(Boolean).join(" · ") || "Operational activity event.",
      timestamp: entry.createdAt || entry.timestamp || "",
      tone: String(entry.level || "info").toLowerCase()
    });
  });

  services.filter((service) => service.status === "offline" || service.status === "degraded").forEach((service) => {
    events.push({
      id: `service-${service.id}`,
      title: `${service.name} ${service.label}`,
      description: service.explanation,
      timestamp: service.lastChecked || payload?.refreshedAt || "",
      tone: service.status === "offline" ? "error" : "warning"
    });
  });

  const unique = [];
  const seen = new Set();
  events
    .sort((left, right) => new Date(right.timestamp || 0).getTime() - new Date(left.timestamp || 0).getTime())
    .forEach((event) => {
      const key = `${event.title}|${event.description}|${event.timestamp}`;
      if (seen.has(key)) return;
      seen.add(key);
      unique.push(event);
    });

  return {
    failed: Boolean(payload?.opsLogsFailed) && !unique.length,
    error: payload?.opsLogsError || "Unable to retrieve system events.",
    items: unique.slice(0, EVENT_LIMIT)
  };
}

function notificationHref(item) {
  const orderId = String(item?.relatedOrderId || "").trim();
  if (orderId) return `#/orders?orderId=${encodeURIComponent(orderId)}`;
  const type = String(item?.type || "").toLowerCase();
  if (type.includes("invent") || type.includes("stock") || type.includes("product")) return "#/inventory";
  if (type.includes("order") || type.includes("payment") || type.includes("refund")) return "#/orders";
  if (type.includes("customer")) return "#/customers";
  return "#/notifications";
}

function buildNotifications(payload) {
  if (payload?.notificationsFailed) {
    return {
      failed: true,
      error: payload?.notificationsError || "Unable to retrieve notifications.",
      unreadCount: null,
      items: []
    };
  }

  const center = asObject(payload?.notifications);
  const items = asList(center.notifications).slice(0, NOTIFICATION_LIMIT).map((item) => ({
    id: String(item.id || ""),
    title: item.title || "Notification",
    message: item.message || "",
    type: item.type || "system",
    priority: item.priority || "normal",
    status: item.status || "unread",
    timestamp: item.createdAt || "",
    href: notificationHref(item)
  }));

  return {
    failed: false,
    unreadCount: asNumber(center.unreadCount),
    items
  };
}

export function buildEnterpriseConsoleModel(payload = {}, options = {}) {
  const activityFilter = String(options.activityFilter || "all").toLowerCase();
  const services = buildSystemServices(payload);
  const summary = summarizeSystem(services);
  const operational = buildOperationalHealth(payload);
  const alerts = buildAlerts(payload, services, operational);
  const activity = buildAdminActivity(payload, activityFilter);
  const events = buildSystemEvents(payload, services);
  const notifications = buildNotifications(payload);

  return {
    summary,
    services,
    operational,
    alerts,
    activity,
    events,
    notifications,
    actions: ADMIN_ACTIONS,
    refreshedAt: payload?.refreshedAt || "",
    activityFilter,
    lookupQuery: String(options.searchQuery || "").trim()
  };
}

function statusClass(status) {
  return `is-${String(status || "unknown").toLowerCase()}`;
}

function serviceCard(service) {
  const checked = service.lastChecked ? formatRelativeTime(service.lastChecked) : "";
  return `
    <article class="ecc-service ${statusClass(service.status)}">
      <div class="ecc-service-head">
        <h3>${escapeHtml(service.name)}</h3>
        <span class="ecc-status ${statusClass(service.status)}">${escapeHtml(service.label)}</span>
      </div>
      <p>${escapeHtml(service.explanation || "Not available")}</p>
      ${checked ? `<small>Last checked: ${escapeHtml(checked)}</small>` : ""}
    </article>
  `;
}

function metricTile(label, value, href, failed, error) {
  if (failed) {
    return `
      <article class="ecc-metric is-error">
        <p>${escapeHtml(label)}</p>
        <strong>Unavailable</strong>
        <small>${escapeHtml(error || "No data available")}</small>
        <button type="button" class="btn btn-ghost" data-enterprise-refresh>Retry</button>
      </article>
    `;
  }

  const display = value == null ? "No data available" : formatNumber(value);
  return `
    <article class="ecc-metric">
      <p>${escapeHtml(label)}</p>
      <strong>${escapeHtml(display)}</strong>
      ${href && value != null ? `<a class="ecc-inline-link" href="${escapeHtml(href)}">Open</a>` : ""}
    </article>
  `;
}

function renderAlerts(model) {
  if (!model.alerts.length) {
    return `<p class="ecc-empty">No active alerts</p>`;
  }

  return `
    <ul class="ecc-alert-list">
      ${model.alerts.map((alert) => `
        <li class="ecc-alert is-${escapeHtml(alert.severity)}">
          <div class="ecc-alert-head">
            <span class="ecc-status is-${escapeHtml(alert.severity)}">${escapeHtml(String(alert.severity || "info").toUpperCase())}</span>
            <strong>${escapeHtml(alert.title)}</strong>
          </div>
          <p>${escapeHtml(alert.description)}</p>
          <div class="ecc-alert-meta">
            ${alert.reference ? `<span>${escapeHtml(alert.reference)}</span>` : ""}
            ${alert.timestamp ? `<time>${escapeHtml(formatRelativeTime(alert.timestamp) || formatDate(alert.timestamp))}</time>` : ""}
            ${alert.href ? `<a class="ecc-inline-link" href="${escapeHtml(alert.href)}">${escapeHtml(alert.action || "Open")}</a>` : ""}
          </div>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderActivity(model) {
  if (model.activity.failed) {
    return `<div class="ecc-error" role="alert"><p>${escapeHtml(model.activity.error)}</p><button type="button" class="btn btn-ghost" data-enterprise-refresh>Retry</button></div>`;
  }
  if (!model.activity.items.length) {
    return `<p class="ecc-empty">No recent admin activity</p>`;
  }

  return `
    <ul class="ecc-feed">
      ${model.activity.items.map((item) => `
        <li>
          <span class="ecc-feed-type">${escapeHtml(humanizeToken(item.eventType) || "Event")}</span>
          <strong>${escapeHtml(item.actor)}</strong>
          <p>${escapeHtml(item.action)}${item.object ? ` · ${escapeHtml(item.object)}` : ""}</p>
          ${item.timestamp ? `<time>${escapeHtml(formatRelativeTime(item.timestamp) || formatDate(item.timestamp))}</time>` : ""}
        </li>
      `).join("")}
    </ul>
  `;
}

function renderEvents(model) {
  if (model.events.failed) {
    return `<div class="ecc-error" role="alert"><p>${escapeHtml(model.events.error)}</p><button type="button" class="btn btn-ghost" data-enterprise-refresh>Retry</button></div>`;
  }
  if (!model.events.items.length) {
    return `<p class="ecc-empty">No system events</p>`;
  }

  return `
    <ul class="ecc-feed">
      ${model.events.items.map((item) => `
        <li class="${escapeHtml(item.tone || "info")}">
          <span class="ecc-feed-type">${escapeHtml(item.title)}</span>
          <p>${escapeHtml(item.description)}</p>
          ${item.timestamp ? `<time>${escapeHtml(formatRelativeTime(item.timestamp) || formatDate(item.timestamp))}</time>` : ""}
        </li>
      `).join("")}
    </ul>
  `;
}

function renderNotifications(model) {
  if (model.notifications.failed) {
    return `<div class="ecc-error" role="alert"><p>${escapeHtml(model.notifications.error)}</p><button type="button" class="btn btn-ghost" data-enterprise-refresh>Retry</button></div>`;
  }
  if (!model.notifications.items.length) {
    return `<p class="ecc-empty">No notifications</p>`;
  }

  return `
    <ul class="ecc-feed">
      ${model.notifications.items.map((item) => `
        <li>
          <span class="ecc-feed-type">${escapeHtml(humanizeToken(item.type))} · ${escapeHtml(String(item.status || "").toUpperCase())}</span>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.message)}</p>
          <div class="ecc-alert-meta">
            ${item.timestamp ? `<time>${escapeHtml(formatRelativeTime(item.timestamp) || formatDate(item.timestamp))}</time>` : ""}
            <a class="ecc-inline-link" href="${escapeHtml(item.href)}">Open</a>
          </div>
        </li>
      `).join("")}
    </ul>
  `;
}

export function buildEnterpriseConsoleMarkup(model, extras = {}) {
  const lastUpdated = model.refreshedAt ? formatClock(model.refreshedAt) : "";
  const unread = model.notifications.failed || model.notifications.unreadCount == null
    ? ""
    : `${formatNumber(model.notifications.unreadCount)} unread`;

  return `
    <section class="ecc-root" data-enterprise-root>
      <header class="ecc-header">
        <div>
          <p class="ecc-kicker">Dashboard</p>
          <h1>Enterprise Console</h1>
          <p class="ecc-lede">Operational &amp; System Control Center</p>
        </div>
        <div class="ecc-header-actions">
          ${lastUpdated ? `<p class="ecc-updated">Last updated: <time datetime="${escapeHtml(model.refreshedAt)}">${escapeHtml(lastUpdated)}</time></p>` : ""}
          <span class="ecc-status ${statusClass(model.summary.key === "operational" ? "online" : model.summary.key === "attention" ? "offline" : model.summary.key === "partial" ? "degraded" : "unknown")}">${escapeHtml(model.summary.label)}</span>
          <button type="button" class="btn btn-secondary" data-enterprise-refresh>Refresh</button>
        </div>
      </header>

      <section class="ecc-summary is-${escapeHtml(model.summary.key)}" aria-live="polite">
        <p class="ecc-summary-label">${escapeHtml(model.summary.label)}</p>
        <p>${escapeHtml(model.summary.detail)}</p>
      </section>

      <section class="ecc-panel ecc-health" aria-labelledby="ecc-health-title">
        <header class="ecc-panel-head">
          <div>
            <h2 id="ecc-health-title">System Health</h2>
            <p>Statuses come from live session, API, health, and notification checks.</p>
          </div>
        </header>
        <div class="ecc-service-grid">
          ${model.services.map(serviceCard).join("")}
        </div>
      </section>

      <section class="ecc-split ecc-ops-alerts">
        <article class="ecc-panel" aria-labelledby="ecc-ops-title">
          <header class="ecc-panel-head">
            <div>
              <h2 id="ecc-ops-title">Operational Health</h2>
              <p>${escapeHtml(model.operational.label)}</p>
            </div>
          </header>
          <div class="ecc-metric-grid">
            ${metricTile("Pending orders", model.operational.pendingOrders, "#/orders?status=pending", model.operational.ordersFailed, model.operational.ordersError)}
            ${metricTile("Processing orders", model.operational.processingOrders, "#/orders", model.operational.ordersFailed, model.operational.ordersError)}
            ${metricTile("Orders awaiting action", model.operational.awaitingAction, "#/orders?status=pending", model.operational.ordersFailed, model.operational.ordersError)}
            ${metricTile("Out of stock", model.operational.outOfStock, "#/inventory", model.operational.productsFailed, model.operational.productsError)}
            ${metricTile("Low stock", model.operational.lowStock, "#/inventory", model.operational.productsFailed, model.operational.productsError)}
            ${metricTile("Open messages", model.operational.openMessages, "#/enterprise", model.operational.messagesFailed, "Unable to retrieve message status.")}
          </div>
        </article>

        <article class="ecc-panel" aria-labelledby="ecc-alert-title">
          <header class="ecc-panel-head">
            <div>
              <h2 id="ecc-alert-title">Alert Center</h2>
              <p>Conditions that currently require administrative attention.</p>
            </div>
          </header>
          ${renderAlerts(model)}
        </article>
      </section>

      <section class="ecc-split ecc-activity-events">
        <article class="ecc-panel" aria-labelledby="ecc-activity-title">
          <header class="ecc-panel-head">
            <div>
              <h2 id="ecc-activity-title">Admin Activity</h2>
              <p>${model.activity.source === "admin-security" ? "Recent administrative security and profile events." : "Recent operational activity from existing logs."}</p>
            </div>
          </header>
          <div class="ecc-filter" role="group" aria-label="Activity filters">
            ${ACTIVITY_FILTERS.map((filter) => `
              <button type="button" class="ecc-filter-btn${model.activityFilter === filter.key ? " is-active" : ""}" data-enterprise-activity-filter="${filter.key}" aria-pressed="${model.activityFilter === filter.key ? "true" : "false"}">${escapeHtml(filter.label)}</button>
            `).join("")}
          </div>
          ${renderActivity(model)}
        </article>

        <article class="ecc-panel" aria-labelledby="ecc-events-title">
          <header class="ecc-panel-head">
            <div>
              <h2 id="ecc-events-title">Recent System Events</h2>
              <p>Safe operational events from monitoring logs and verified service checks.</p>
            </div>
          </header>
          ${renderEvents(model)}
        </article>
      </section>

      <section class="ecc-split ecc-notes-actions">
        <article class="ecc-panel" aria-labelledby="ecc-notes-title">
          <header class="ecc-panel-head">
            <div>
              <h2 id="ecc-notes-title">Notifications</h2>
              <p>${unread ? escapeHtml(unread) : "Recent administrative notifications."}</p>
            </div>
            <a class="ecc-inline-link" href="#/notifications">Open inbox</a>
          </header>
          ${renderNotifications(model)}
        </article>

        <article class="ecc-panel" aria-labelledby="ecc-actions-title">
          <header class="ecc-panel-head">
            <div>
              <h2 id="ecc-actions-title">Administrative Operations</h2>
              <p>Existing admin destinations only.</p>
            </div>
          </header>
          <div class="ecc-actions">
            ${model.actions.map((action) => `
              <a class="ecc-action" href="${escapeHtml(action.href)}">
                <strong>${escapeHtml(action.title)}</strong>
                <span>${escapeHtml(action.note)}</span>
              </a>
            `).join("")}
          </div>
        </article>
      </section>

      ${extras.lookupHtml || ""}
    </section>
  `;
}

export function renderEnterpriseConsoleLoading() {
  return `
    <section class="ecc-root ecc-loading" aria-busy="true" aria-live="polite">
      <header class="ecc-header">
        <div>
          <span class="skeleton-line skeleton-line-lg"></span>
          <span class="skeleton-line"></span>
        </div>
        <span class="skeleton-pill"></span>
      </header>
      <section class="ecc-summary"><span class="skeleton-line"></span></section>
      <section class="ecc-panel">
        <span class="skeleton-line skeleton-line-lg"></span>
        <div class="ecc-service-grid">
          <article class="ecc-service"><span class="skeleton-line"></span><span class="skeleton-line"></span></article>
          <article class="ecc-service"><span class="skeleton-line"></span><span class="skeleton-line"></span></article>
          <article class="ecc-service"><span class="skeleton-line"></span><span class="skeleton-line"></span></article>
          <article class="ecc-service"><span class="skeleton-line"></span><span class="skeleton-line"></span></article>
        </div>
      </section>
      <section class="ecc-split">
        <article class="ecc-panel"><span class="skeleton-line"></span><div class="skeleton-box" style="height:140px"></div></article>
        <article class="ecc-panel"><span class="skeleton-line"></span><div class="skeleton-box" style="height:140px"></div></article>
      </section>
    </section>
  `;
}

export function bindEnterpriseConsoleActions(container, { onRefresh, onFilter } = {}) {
  if (!container) return;

  container.querySelectorAll("[data-enterprise-refresh]").forEach((button) => {
    button.addEventListener("click", () => {
      if (typeof onRefresh === "function") {
        onRefresh({ force: true });
      }
    });
  });

  container.querySelectorAll("[data-enterprise-activity-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const filter = String(button.getAttribute("data-enterprise-activity-filter") || "all");
      if (typeof onFilter === "function") {
        onFilter(filter);
      }
    });
  });
}
