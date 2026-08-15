import { formatCurrency } from "../components/ui.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function lowerText(value) {
  return normalizeText(value).toLowerCase();
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatDate(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function escapeCsv(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function downloadBlob(filename, mimeType, content) {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    window.URL.revokeObjectURL(url);
    anchor.remove();
  }, 120);
}

function buildCsv(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    return "";
  }

  const headers = Object.keys(rows[0]);
  const lines = [headers.map(escapeCsv).join(",")];

  rows.forEach((row) => {
    lines.push(headers.map((header) => escapeCsv(row?.[header])).join(","));
  });

  return lines.join("\n");
}

export function downloadCsvFile(filename, rows) {
  downloadBlob(filename, "text/csv;charset=utf-8", buildCsv(asArray(rows)));
}

export function downloadJsonFile(filename, payload) {
  downloadBlob(filename, "application/json;charset=utf-8", JSON.stringify(payload || {}, null, 2));
}

export function openPrintableReport(title, sections, options = {}) {
  const reportSections = asArray(sections)
    .map((section) => `
      <section class="report-section">
        <h2>${normalizeText(section?.title) || "Section"}</h2>
        ${section?.subtitle ? `<p>${normalizeText(section.subtitle)}</p>` : ""}
        ${section?.content || ""}
      </section>
    `)
    .join("");

  const reportHtml = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${normalizeText(title) || "Enterprise Report"}</title>
        <style>
          body { font-family: Segoe UI, Arial, sans-serif; margin: 0; padding: 24px; color: #152033; background: #f6f8fc; }
          h1 { margin: 0 0 8px; }
          p { line-height: 1.5; }
          .meta { color: #5c708b; margin-bottom: 24px; }
          .report-section { background: #fff; border: 1px solid #d8e1ee; border-radius: 16px; padding: 16px; margin-bottom: 16px; }
          .report-section h2 { margin: 0 0 6px; font-size: 18px; }
          .report-section table { width: 100%; border-collapse: collapse; }
          .report-section th, .report-section td { border-bottom: 1px solid #e9eef6; padding: 8px 6px; text-align: left; font-size: 13px; }
          .report-section th { background: #f4f7fb; }
          .pill { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #e7f1ff; color: #0a4f99; font-size: 12px; margin-right: 6px; margin-bottom: 6px; }
        </style>
      </head>
      <body>
        <h1>${normalizeText(title) || "Enterprise Report"}</h1>
        <p class="meta">Generated ${formatDate(new Date().toISOString())}</p>
        ${reportSections}
      </body>
    </html>
  `;

  const reportWindow = window.open("", "_blank", "noopener,noreferrer,width=1200,height=900");
  if (!reportWindow) {
    return false;
  }

  reportWindow.document.open();
  reportWindow.document.write(reportHtml);
  reportWindow.document.close();
  reportWindow.focus();
  if (options?.autoPrint !== false) {
    window.setTimeout(() => {
      try {
        reportWindow.print();
      } catch (_error) {
        // Ignore print failures in restricted browsers.
      }
    }, 250);
  }

  return true;
}

function resultScore(query, text) {
  const normalizedQuery = lowerText(query);
  const normalizedText = lowerText(text);
  if (!normalizedQuery) {
    return 0;
  }

  if (normalizedText === normalizedQuery) {
    return 5;
  }

  if (normalizedText.includes(normalizedQuery)) {
    return 3;
  }

  return 0;
}

function buildSearchRecord(type, source, detail, date, keywords = []) {
  return {
    type,
    id: normalizeText(source?.id || source?.orderId || source?.messageId || source?.catalogId || source?._id || `${type}-${date || Date.now()}`),
    title: normalizeText(detail?.title || source?.name || source?.customerName || source?.event || source?.messageId || source?.orderId || type),
    subtitle: normalizeText(detail?.subtitle || detail?.summary || ""),
    status: normalizeText(detail?.status || source?.status || source?.orderStatus || source?.paymentStatus || ""),
    tone: normalizeText(detail?.tone || "neutral"),
    date: date || source?.createdAt || source?.updatedAt || new Date().toISOString(),
    keywords: Array.from(new Set([
      normalizeText(type),
      normalizeText(source?.id),
      normalizeText(source?.orderId),
      normalizeText(source?.messageId),
      normalizeText(source?.catalogId),
      normalizeText(source?.name),
      normalizeText(source?.customerName),
      normalizeText(source?.email),
      normalizeText(source?.phone),
      normalizeText(source?.category),
      normalizeText(source?.status),
      normalizeText(source?.orderStatus),
      normalizeText(source?.paymentStatus),
      normalizeText(source?.event),
      normalizeText(source?.eventType),
      ...(Array.isArray(keywords) ? keywords.map((keyword) => normalizeText(keyword)) : [])
    ].filter(Boolean))),
    source,
    detail
  };
}

export function buildEnterpriseSearchIndex({ orders = [], customers = [], products = [], messages = [], activity = [], carts = [] } = {}) {
  const records = [];

  asArray(orders).forEach((order) => {
    records.push(buildSearchRecord("Order", order, {
      title: order.orderId || order.id || "Order",
      subtitle: `${normalizeText(order.customerName) || "Guest"} • ${formatCurrency(order.total || order.totalAmount || order.totalPrice || 0)}`,
      status: order.status || order.orderStatus || order.paymentStatus,
      tone: order.status
    }, order.createdAt, [order.customerEmail, order.customerPhone]));
  });

  asArray(customers).forEach((customer) => {
    records.push(buildSearchRecord("Customer", customer, {
      title: customer.name || customer.id || "Customer",
      subtitle: `${normalizeText(customer.email) || normalizeText(customer.phone) || "No contact"} • ${Number(customer.totalOrders || 0)} orders`,
      status: customer.status || (customer.verified ? "Verified" : "Active")
    }, customer.joinedAt || customer.createdAt, [customer.email, customer.phone]));
  });

  asArray(products).forEach((product) => {
    records.push(buildSearchRecord("Product", product, {
      title: product.name || product.title || "Product",
      subtitle: `${normalizeText(product.category) || "general"} • ${formatCurrency(product.price || 0)} • Stock ${Number(product.stock || 0)}`,
      status: product.visibility || product.status || "both"
    }, product.updatedAt || product.createdAt, [product.sku, product.highlightTag]));
  });

  asArray(messages).forEach((message) => {
    records.push(buildSearchRecord("Message", message, {
      title: message.name || message.messageId || "Message",
      subtitle: `${normalizeText(message.email) || normalizeText(message.phone) || "No contact"} • ${normalizeText(message.message).slice(0, 70) || "No preview"}`,
      status: message.status || "New"
    }, message.createdAt, [message.source]));
  });

  asArray(activity).forEach((entry) => {
    records.push(buildSearchRecord("Activity", entry, {
      title: entry.event || entry.type || "Activity",
      subtitle: `${normalizeText(entry.path) || "Operational event"} • ${normalizeText(entry.device) || "Device"}`,
      status: entry.level || entry.eventType || "info"
    }, entry.createdAt || entry.timestamp, [entry.city, entry.country, entry.device]));
  });

  asArray(carts).forEach((cart) => {
    records.push(buildSearchRecord("Cart", cart, {
      title: cart.id || "Cart",
      subtitle: `${normalizeText(cart.userName) || "Customer"} • ${toNumber(cart.itemCount)} items • ${formatCurrency(cart.estimatedTotal || 0)}`,
      status: toNumber(cart.itemCount) > 0 ? "Active" : "Empty"
    }, cart.updatedAt || cart.createdAt, [cart.userEmail, cart.userPhone]));
  });

  return records;
}

export function searchEnterpriseRecords(records, query, filters = {}) {
  const normalizedQuery = lowerText(query);
  const normalizedType = lowerText(filters?.type || "all");
  const normalizedStatus = lowerText(filters?.status || "all");

  return asArray(records)
    .filter((record) => {
      if (normalizedType !== "all" && lowerText(record?.type) !== normalizedType) {
        return false;
      }

      if (normalizedStatus !== "all" && lowerText(record?.status) !== normalizedStatus && !lowerText(record?.status).includes(normalizedStatus)) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const haystack = [record?.title, record?.subtitle, record?.status, ...(Array.isArray(record?.keywords) ? record.keywords : [])].join(" | ");
      return resultScore(normalizedQuery, haystack) > 0;
    })
    .map((record) => ({
      ...record,
      score: resultScore(normalizedQuery, [record?.title, record?.subtitle, record?.status, ...(Array.isArray(record?.keywords) ? record.keywords : [])].join(" | "))
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime();
    });
}

export function buildOperationalAlerts({ intelligence = {}, analytics = {}, inventory = {}, dashboard = {}, orders = [], customers = [], products = [], messages = [], activity = [], carts = [] } = {}) {
  const alerts = [];
  const monitoring = intelligence?.monitoring || analytics?.monitoring || {};
  const kpi = monitoring?.kpi || {};
  const freshness = String(monitoring?.staleLabel || "just now");
  const lowStock = Number(inventory?.lowStock || kpi?.lowStock || 0);
  const outOfStock = Number(inventory?.outOfStock || kpi?.outOfStock || 0);
  const pendingOrders = Number(kpi?.pendingOrders || dashboard?.stats?.pendingOrders || 0);
  const openMessages = Number(kpi?.openMessages || 0);
  const conversionRate = Number(kpi?.conversionRate || analytics?.conversionRate || 0);
  const fulfillmentRate = Number(kpi?.fulfillmentRate || 0);
  const activeCarts = Number(kpi?.activeCarts || dashboard?.stats?.cartsWithItems || asArray(carts).filter((cart) => toNumber(cart.itemCount) > 0).length || 0);
  const totalCartItems = Number(kpi?.totalCartItems || dashboard?.stats?.totalCartItems || asArray(carts).reduce((sum, cart) => sum + toNumber(cart.itemCount), 0) || 0);
  const suspiciousEvents = asArray(activity).filter((entry) => /fail|error|denied|blocked|unauthor/i.test(JSON.stringify(entry || {})) || /login/i.test(lowerText(entry?.event || entry?.type || entry?.path)));

  if (lowStock > 0) {
    alerts.push({ tone: "warn", title: "Low inventory risk", detail: `${lowStock} items are at or below the reorder threshold.` });
  }

  if (outOfStock > 0) {
    alerts.push({ tone: "danger", title: "Out of stock products", detail: `${outOfStock} products currently have zero stock.` });
  }

  if (pendingOrders > 15) {
    alerts.push({ tone: "warn", title: "Order backlog growing", detail: `${pendingOrders} orders are pending in the operational queue.` });
  }

  if (activeCarts > 0 && totalCartItems > (pendingOrders + 20)) {
    alerts.push({ tone: "warn", title: "Cart-to-order conversion gap", detail: `${activeCarts} active carts with ${totalCartItems} items may indicate checkout drop-off.` });
  }

  if (openMessages > 10) {
    alerts.push({ tone: "warn", title: "Support inbox pressure", detail: `${openMessages} new support messages are still open.` });
  }

  if (suspiciousEvents.length > 0) {
    alerts.push({ tone: "danger", title: "Suspicious activity detected", detail: `${suspiciousEvents.length} log entries match failure or access-risk patterns.` });
  }

  if (Number(monitoring?.staleSeconds || 0) > 120) {
    alerts.push({ tone: "warn", title: "Sync freshness lagging", detail: `Realtime data is ${freshness} old.` });
  }

  if (conversionRate > 0 && conversionRate < 1) {
    alerts.push({ tone: "warn", title: "Conversion is below target", detail: `Current conversion is ${conversionRate.toFixed(2)}% and needs attention.` });
  }

  if (fulfillmentRate > 0 && fulfillmentRate < 80) {
    alerts.push({ tone: "warn", title: "Fulfillment is slipping", detail: `Fulfillment rate is ${fulfillmentRate.toFixed(2)}%.` });
  }

  if (!alerts.length) {
    alerts.push({ tone: "success", title: "Systems healthy", detail: "No current operational alerts were triggered." });
  }

  return alerts;
}

export function buildTopCustomers(customers = []) {
  return asArray(customers)
    .map((customer) => ({
      id: normalizeText(customer.id),
      name: normalizeText(customer.name) || "Customer",
      totalOrders: toNumber(customer.totalOrders),
      totalSpent: toNumber(customer.totalSpent),
      email: normalizeText(customer.email),
      joinedAt: customer.joinedAt || customer.createdAt || new Date().toISOString()
    }))
    .sort((left, right) => right.totalSpent - left.totalSpent || right.totalOrders - left.totalOrders)
    .slice(0, 8);
}

export function buildBestSellingProducts(analytics = {}, orders = []) {
  const source = asArray(analytics?.topProducts).length ? asArray(analytics.topProducts) : [];
  if (source.length) {
    return source
      .map((item) => ({
        id: normalizeText(item.id),
        name: normalizeText(item.name) || "Product",
        quantity: toNumber(item.quantity),
        revenue: toNumber(item.revenue)
      }))
      .sort((left, right) => right.revenue - left.revenue)
      .slice(0, 8);
  }

  const lookup = new Map();
  asArray(orders).forEach((order) => {
    asArray(order.items || order.products).forEach((item) => {
      const key = normalizeText(item.productId || item.id || item.productName || item.name);
      if (!key) return;
      const current = lookup.get(key) || { id: normalizeText(item.productId || item.id), name: normalizeText(item.productName || item.name) || "Product", quantity: 0, revenue: 0 };
      const quantity = Math.max(1, toNumber(item.quantity || item.qty || 1) || 1);
      const price = toNumber(item.price || 0);
      current.quantity += quantity;
      current.revenue += quantity * price;
      lookup.set(key, current);
    });
  });

  return Array.from(lookup.values()).sort((left, right) => right.revenue - left.revenue).slice(0, 8);
}

export function buildRevenueForecast(analytics = {}) {
  const weeklySales = asArray(analytics?.weeklySales);
  const total = weeklySales.reduce((sum, entry) => sum + toNumber(entry.total || entry.value || 0), 0);
  const dailyAverage = weeklySales.length ? total / weeklySales.length : 0;

  return {
    dailyAverage,
    projected30DayRevenue: dailyAverage * 30,
    momentum: dailyAverage > 0 ? "positive" : "flat",
    note: dailyAverage > 0 ? `Based on the last ${weeklySales.length || 7} days of sales.` : "No recent sales trend available for forecasting."
  };
}

export function buildBehaviorInsights({ customers = [], activity = [], messages = [] } = {}) {
  const returningCustomers = asArray(customers).filter((customer) => toNumber(customer.totalOrders) >= 2).length;
  const engagedCustomers = asArray(activity).filter((entry) => /visit|browse|view|add/i.test(lowerText(entry?.event || entry?.type || entry?.path))).length;
  const openConversations = asArray(messages).filter((message) => /new|review/i.test(lowerText(message?.status))).length;

  return {
    returningCustomers,
    engagementSignals: engagedCustomers,
    openConversations,
    loyaltyRate: customers.length ? (returningCustomers / customers.length) * 100 : 0,
    insight: returningCustomers > 0
      ? `${returningCustomers} customers have placed multiple orders.`
      : "Customer loyalty signals are not yet established."
  };
}

export function buildGroupedActivity(activity = []) {
  const buckets = new Map();

  asArray(activity).forEach((entry) => {
    const type = normalizeText(entry?.type || entry?.eventType || "Activity");
    const bucket = buckets.get(type) || { type, count: 0, latest: [] };
    bucket.count += 1;
    bucket.latest.push(entry);
    buckets.set(type, bucket);
  });

  return Array.from(buckets.values())
    .map((bucket) => ({
      ...bucket,
      latest: bucket.latest
        .sort((left, right) => new Date(right.createdAt || right.timestamp || 0).getTime() - new Date(left.createdAt || left.timestamp || 0).getTime())
        .slice(0, 3)
    }))
    .sort((left, right) => right.count - left.count);
}

export function buildExecutiveSummary({ dashboard = {}, analytics = {}, intelligence = {}, inventory = {}, alerts = [], forecast = {}, behavior = {} } = {}) {
  const stats = dashboard?.stats || {};
  return [
    {
      label: "Revenue",
      value: formatCurrency(stats.totalSales || analytics?.totalRevenue || 0)
    },
    {
      label: "Orders",
      value: String(stats.ordersCount || stats.orders || 0)
    },
    {
      label: "Customers",
      value: String(stats.customersCount || stats.customers || 0)
    },
    {
      label: "Products",
      value: String(stats.productsCount || stats.products || inventory?.totalSku || 0)
    },
    {
      label: "Active Carts",
      value: String(stats.cartsWithItems || stats.cartsCount || 0)
    },
    {
      label: "Alerts",
      value: String(alerts.length)
    },
    {
      label: "Forecast",
      value: formatCurrency(forecast.projected30DayRevenue || 0)
    },
    {
      label: "Loyalty",
      value: `${Number(behavior.loyaltyRate || 0).toFixed(1)}%`
    },
    {
      label: "Freshness",
      value: String(intelligence?.monitoring?.staleLabel || "just now")
    }
  ];
}

export function buildReportRows({ orders = [], customers = [], products = [], messages = [], activity = [], carts = [] } = {}) {
  return {
    orders: asArray(orders).map((order) => ({
      Order: normalizeText(order.orderId || order.id),
      Customer: normalizeText(order.customerName) || "Guest",
      Email: normalizeText(order.customerEmail),
      Phone: normalizeText(order.customerPhone),
      Status: normalizeText(order.status || order.orderStatus),
      Total: toNumber(order.total || order.totalAmount || order.totalPrice || 0),
      Date: formatDate(order.date || order.createdAt)
    })),
    customers: asArray(customers).map((customer) => ({
      Name: normalizeText(customer.name),
      Email: normalizeText(customer.email),
      Phone: normalizeText(customer.phone),
      Orders: toNumber(customer.totalOrders),
      Spent: toNumber(customer.totalSpent),
      Joined: formatDate(customer.joinedAt || customer.createdAt)
    })),
    products: asArray(products).map((product) => ({
      Product: normalizeText(product.name || product.title),
      Category: normalizeText(product.category),
      Stock: toNumber(product.stock),
      Price: toNumber(product.price),
      Visibility: normalizeText(product.visibility || product.status),
      Updated: formatDate(product.updatedAt || product.createdAt)
    })),
    messages: asArray(messages).map((message) => ({
      Name: normalizeText(message.name),
      Email: normalizeText(message.email),
      Status: normalizeText(message.status),
      Source: normalizeText(message.source),
      Date: formatDate(message.createdAt)
    })),
    carts: asArray(carts).map((cart) => ({
      Cart: normalizeText(cart.id),
      Customer: normalizeText(cart.userName),
      Email: normalizeText(cart.userEmail),
      Items: toNumber(cart.itemCount),
      Value: toNumber(cart.estimatedTotal),
      Updated: formatDate(cart.updatedAt || cart.createdAt)
    })),
    activity: asArray(activity).map((entry) => ({
      Event: normalizeText(entry.event || entry.type),
      Level: normalizeText(entry.level),
      Path: normalizeText(entry.path),
      Device: normalizeText(entry.device),
      Date: formatDate(entry.createdAt || entry.timestamp)
    }))
  };
}
