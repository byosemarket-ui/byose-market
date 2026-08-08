/**
 * Responsive HTML email templates for admin notification events.
 * Each event has its own subject + body content; layout is shared.
 */

const { normalizeText } = require('../../config/notification-mail.config');

const BRAND = Object.freeze({
    name: 'BYOSE Market',
    primary: '#0f766e',
    primaryDark: '#115e59',
    accent: '#0d9488',
    bg: '#f4f7f6',
    card: '#ffffff',
    text: '#16322d',
    muted: '#5b6b66',
    border: '#d7e3df',
    danger: '#be123c',
    warning: '#b45309',
    info: '#0369a1'
});

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDateTime(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    if (!Number.isFinite(date.getTime())) {
        return new Date().toUTCString();
    }
    return date.toUTCString();
}

function money(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '—';
    return `${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })} RWF`;
}

function detailRows(rows = []) {
    return rows
        .filter((row) => row && row.label && row.value)
        .map((row) => `
          <tr>
            <td style="padding:8px 0;color:${BRAND.muted};font-size:13px;width:38%;vertical-align:top;">${escapeHtml(row.label)}</td>
            <td style="padding:8px 0;color:${BRAND.text};font-size:14px;font-weight:600;vertical-align:top;">${escapeHtml(row.value)}</td>
          </tr>
        `)
        .join('');
}

function buildAdminEmailShell({
    title,
    preview,
    summary,
    details = [],
    ctaLabel = 'Open Admin Dashboard',
    ctaUrl = '',
    accent = BRAND.primary,
    footerNote = 'You received this message because admin email notifications are enabled for BYOSE Market.'
} = {}) {
    const safeTitle = escapeHtml(title);
    const safeSummary = escapeHtml(summary);
    const safePreview = escapeHtml(preview || title);
    const when = escapeHtml(formatDateTime());
    const buttonUrl = normalizeText(ctaUrl) || '#';
    const buttonLabel = escapeHtml(ctaLabel);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${safeTitle}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.text};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safePreview}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:16px;overflow:hidden;">
          <tr>
            <td style="background:linear-gradient(135deg,${BRAND.primaryDark},${accent});padding:28px 28px 24px;">
              <p style="margin:0 0 6px;color:rgba(255,255,255,0.85);font-size:12px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">${escapeHtml(BRAND.name)}</p>
              <h1 style="margin:0;color:#ffffff;font-size:24px;line-height:1.3;font-weight:700;">${safeTitle}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:${BRAND.text};">${safeSummary}</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${BRAND.border};border-bottom:1px solid ${BRAND.border};margin:0 0 22px;">
                ${detailRows(details)}
                <tr>
                  <td style="padding:8px 0;color:${BRAND.muted};font-size:13px;width:38%;">Date &amp; Time</td>
                  <td style="padding:8px 0;color:${BRAND.text};font-size:14px;font-weight:600;">${when}</td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
                <tr>
                  <td style="border-radius:10px;background:${BRAND.primary};">
                    <a href="${escapeHtml(buttonUrl)}" style="display:inline-block;padding:12px 20px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">${buttonLabel}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:14px 0 0;font-size:12px;line-height:1.5;color:${BRAND.muted};">If the button does not work, open: ${escapeHtml(buttonUrl)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 24px;background:#f8fbfa;border-top:1px solid ${BRAND.border};">
              <p style="margin:0;font-size:12px;line-height:1.5;color:${BRAND.muted};">${escapeHtml(footerNote)}</p>
              <p style="margin:8px 0 0;font-size:12px;color:${BRAND.muted};">&copy; ${new Date().getFullYear()} ${escapeHtml(BRAND.name)}. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const text = [
        `${BRAND.name}`,
        title,
        '',
        summary,
        '',
        ...details.filter((row) => row?.label && row?.value).map((row) => `${row.label}: ${row.value}`),
        `Date & Time: ${formatDateTime()}`,
        '',
        `${ctaLabel}: ${buttonUrl}`,
        '',
        footerNote
    ].join('\n');

    return { html, text };
}

function orderDetails(order = {}, extras = []) {
    return [
        { label: 'Order ID', value: normalizeText(order.orderId || order.id || order._id) },
        { label: 'Customer', value: normalizeText(order.customerName || order.shippingAddress?.fullName || order.customerEmail || 'Customer') },
        { label: 'Customer Email', value: normalizeText(order.customerEmail || order.userEmail) },
        { label: 'Phone', value: normalizeText(order.customerPhone || order.phoneNumber || order.shippingAddress?.phone) },
        { label: 'Status', value: normalizeText(order.status || order.orderStatus) },
        { label: 'Payment Status', value: normalizeText(order.paymentStatus || order.payment?.status) },
        { label: 'Payment Method', value: normalizeText(order.paymentMethod || order.payment?.method) },
        { label: 'Total', value: money(order.totalAmount || order.totalPrice) },
        ...extras
    ];
}

function productDetails(product = {}, extras = []) {
    return [
        { label: 'Product', value: normalizeText(product.name || product.title || product.catalogId) },
        { label: 'Catalog ID', value: normalizeText(product.catalogId || product.id || product._id) },
        { label: 'Stock', value: String(Number.isFinite(Number(product.stock)) ? Number(product.stock) : '—') },
        ...extras
    ];
}

function customerDetails(customer = {}, extras = []) {
    return [
        { label: 'Customer', value: normalizeText(customer.name || customer.email || customer.phone || 'Customer') },
        { label: 'Email', value: normalizeText(customer.email) },
        { label: 'Phone', value: normalizeText(customer.phone) },
        { label: 'Customer ID', value: normalizeText(customer.id || customer._id || customer.customerId) },
        ...extras
    ];
}

const EVENT_TEMPLATE_DEFS = Object.freeze({
    ORDER_CREATED: {
        title: 'New Order Received',
        accent: BRAND.primary,
        ctaLabel: 'Review Order',
        ctaRoute: 'orders',
        summary: (ctx) => `A new order was placed and needs attention in the admin dashboard.`
    },
    PAYMENT_RECEIVED: {
        title: 'Payment Successfully Received',
        accent: BRAND.info,
        ctaLabel: 'View Payment Details',
        ctaRoute: 'orders',
        summary: () => 'Payment for an order has been confirmed successfully.'
    },
    PAYMENT_FAILED: {
        title: 'Payment Failed',
        accent: BRAND.danger,
        ctaLabel: 'Inspect Order',
        ctaRoute: 'orders',
        summary: () => 'A payment attempt failed and may need customer follow-up.'
    },
    ORDER_CONFIRMED: {
        title: 'Order Confirmed',
        accent: BRAND.primary,
        ctaLabel: 'Open Order',
        ctaRoute: 'orders',
        summary: () => 'An order has been confirmed and is ready for fulfillment.'
    },
    ORDER_PROCESSING: {
        title: 'Order Processing',
        accent: BRAND.accent,
        ctaLabel: 'Open Order',
        ctaRoute: 'orders',
        summary: () => 'An order moved into processing.'
    },
    ORDER_PACKED: {
        title: 'Order Packed',
        accent: BRAND.accent,
        ctaLabel: 'Open Order',
        ctaRoute: 'orders',
        summary: () => 'An order has been packed and is awaiting shipment.'
    },
    ORDER_SHIPPED: {
        title: 'Order Shipped',
        accent: BRAND.info,
        ctaLabel: 'Track Order',
        ctaRoute: 'orders',
        summary: () => 'An order has been marked as shipped.'
    },
    ORDER_DELIVERED: {
        title: 'Order Delivered',
        accent: BRAND.primary,
        ctaLabel: 'Open Order',
        ctaRoute: 'orders',
        summary: () => 'An order was marked as delivered.'
    },
    ORDER_CANCELLED: {
        title: 'Order Cancelled',
        accent: BRAND.danger,
        ctaLabel: 'Review Cancellation',
        ctaRoute: 'orders',
        summary: () => 'An order was cancelled.'
    },
    REFUND_REQUESTED: {
        title: 'Refund Requested',
        accent: BRAND.warning,
        ctaLabel: 'Review Refund',
        ctaRoute: 'orders',
        summary: () => 'A refund or return request needs admin review.'
    },
    REFUND_APPROVED: {
        title: 'Refund Approved',
        accent: BRAND.primary,
        ctaLabel: 'View Refund',
        ctaRoute: 'orders',
        summary: () => 'A refund request was approved.'
    },
    REFUND_REJECTED: {
        title: 'Refund Rejected',
        accent: BRAND.danger,
        ctaLabel: 'View Refund',
        ctaRoute: 'orders',
        summary: () => 'A refund request was rejected.'
    },
    CUSTOMER_REGISTERED: {
        title: 'New Customer Registration',
        accent: BRAND.info,
        ctaLabel: 'View Customers',
        ctaRoute: 'customers',
        summary: () => 'A new customer account was created on BYOSE Market.'
    },
    LOW_STOCK: {
        title: 'Low Stock Alert',
        accent: BRAND.warning,
        ctaLabel: 'Open Inventory',
        ctaRoute: 'inventory',
        summary: () => 'A product is running low and may need restocking soon.'
    },
    OUT_OF_STOCK: {
        title: 'Out of Stock Alert',
        accent: BRAND.danger,
        ctaLabel: 'Open Inventory',
        ctaRoute: 'inventory',
        summary: () => 'A product is now out of stock.'
    }
});

function resolveAdminCtaUrl(baseUrl, routeKey, relatedId = '') {
    const root = normalizeText(baseUrl).replace(/\/+$/, '') || 'https://byosemarket.com';
    const hashRoute = normalizeText(routeKey, 'notifications');
    const id = normalizeText(relatedId);
    if (hashRoute === 'orders' && id) {
        return `${root}/admin/dashboard.html#/orders?orderId=${encodeURIComponent(id)}`;
    }
    if (hashRoute === 'customers') {
        return `${root}/admin/dashboard.html#/customers`;
    }
    if (hashRoute === 'inventory' || hashRoute === 'products') {
        return `${root}/admin/dashboard.html#/inventory`;
    }
    if (hashRoute === 'notifications') {
        return `${root}/admin/dashboard.html#/notifications`;
    }
    return `${root}/admin/dashboard.html#/${hashRoute}`;
}

function buildAdminEventEmail(eventKey, context = {}, options = {}) {
    const def = EVENT_TEMPLATE_DEFS[eventKey];
    if (!def) {
        return null;
    }

    const notification = context.notification || {};
    const order = context.order || {};
    const product = context.product || {};
    const customer = context.customer || {};
    const appBaseUrl = options.appBaseUrl || process.env.APP_BASE_URL || 'https://byosemarket.com';

    let details = [];
    let relatedId = '';

    if (eventKey.startsWith('ORDER_') || eventKey.startsWith('PAYMENT_') || eventKey.startsWith('REFUND_')) {
        details = orderDetails(order, [
            { label: 'Notification', value: normalizeText(notification.title || def.title) }
        ]);
        relatedId = normalizeText(order.orderId || order.id || notification.relatedOrderId);
    } else if (eventKey === 'CUSTOMER_REGISTERED') {
        details = customerDetails(customer);
        relatedId = normalizeText(customer.id || customer._id);
    } else if (eventKey === 'LOW_STOCK' || eventKey === 'OUT_OF_STOCK') {
        details = productDetails(product, [
            { label: 'Alert Level', value: eventKey === 'OUT_OF_STOCK' ? 'Out of stock' : 'Low stock' }
        ]);
        relatedId = normalizeText(product.catalogId || product.id);
    }

    const summary = typeof def.summary === 'function'
        ? def.summary(context)
        : normalizeText(notification.message || def.title);

    const ctaUrl = resolveAdminCtaUrl(appBaseUrl, def.ctaRoute, relatedId);
    const subject = `[BYOSE] ${def.title}${relatedId ? ` — ${relatedId}` : ''}`;
    const shell = buildAdminEmailShell({
        title: def.title,
        preview: normalizeText(notification.message || summary),
        summary: normalizeText(notification.message || summary),
        details,
        ctaLabel: def.ctaLabel,
        ctaUrl,
        accent: def.accent
    });

    return {
        subject,
        html: shell.html,
        text: shell.text,
        eventKey,
        ctaUrl
    };
}

function listEmailEventKeys() {
    return Object.keys(EVENT_TEMPLATE_DEFS);
}

module.exports = {
    BRAND,
    EVENT_TEMPLATE_DEFS,
    buildAdminEventEmail,
    buildAdminEmailShell,
    listEmailEventKeys,
    resolveAdminCtaUrl,
    escapeHtml
};
