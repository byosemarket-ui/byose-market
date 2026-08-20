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

function money(value, currency = 'RWF') {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '—';
    const unit = normalizeText(currency, 'RWF').toUpperCase() || 'RWF';
    return `${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })} ${unit}`;
}

function lower(value) {
    return normalizeText(value).toLowerCase();
}

function isPaidPaymentStatus(value) {
    const status = lower(value);
    if (!status || status.includes('unpaid') || status.includes('awaiting') || status.includes('refund')) {
        return false;
    }
    return status === 'paid'
        || status === 'success'
        || status === 'successful'
        || status === 'completed'
        || /(^|_)paid($|_)/.test(status)
        || status.endsWith('_paid');
}

function isFailedPaymentStatus(value) {
    const status = lower(value);
    return status === 'failed'
        || status === 'fail'
        || status === 'declined'
        || status === 'payment_failed'
        || status.endsWith('_failed')
        || status.includes('declined');
}

function isCancelledPaymentStatus(value) {
    const status = lower(value);
    return status === 'cancelled'
        || status === 'canceled'
        || status === 'payment_cancelled'
        || status === 'payment_canceled';
}

function safePaymentReference(order = {}) {
    return normalizeText(
        order.paymentReference
        || order.transactionReference
        || order.transactionId
        || order.payment?.reference
        || order.payment?.transaction?.reference
    );
}

function paymentEventTimestamp(order = {}) {
    return normalizeText(
        order.payment?.gateway?.verifiedAt
        || order.payment?.gateway?.updatedAt
        || order.updatedAt
        || order.createdAt
    );
}

function paymentFailureDetail(order = {}) {
    return normalizeText(
        order.payment?.gateway?.lastExplanation
        || order.paymentStatusLabel
        || order.payment?.statusLabel
        || humanizeStatus(order.paymentStatus || order.payment?.status)
    );
}

function humanizeStatus(value) {
    const raw = normalizeText(value);
    if (!raw) return '';
    return raw
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function orderPaymentStatus(order = {}) {
    return normalizeText(
        order.paymentStatusLabel
        || order.payment?.statusLabel
        || humanizeStatus(order.paymentStatus || order.payment?.status)
    );
}

function orderPaymentMethod(order = {}) {
    return normalizeText(
        order.paymentMethodLabel
        || order.payment?.methodLabel
        || humanizeStatus(order.paymentMethod || order.payment?.method)
    );
}

function collectOrderItems(order = {}) {
    const source = Array.isArray(order.items) && order.items.length
        ? order.items
        : (Array.isArray(order.products) ? order.products : []);
    return source.map((item) => {
        const quantity = Math.max(0, Number(item?.quantity ?? item?.qty) || 0);
        const unitPrice = Number(item?.price || item?.unitPrice || 0) || 0;
        const variant = [
            normalizeText(item?.colorName || item?.color),
            normalizeText(item?.sizeLabel || item?.size)
        ].filter(Boolean).join(' / ');
        return {
            name: normalizeText(item?.productName || item?.name, 'Product'),
            productId: normalizeText(item?.productId || item?.id || item?.catalogId),
            sku: normalizeText(item?.sku || item?.variantSku || item?.attributes?.SKU || item?.attributes?.sku),
            quantity,
            unitPrice,
            lineTotal: unitPrice * quantity,
            variant: variant || normalizeText(item?.attributeSummary || item?.variantKey)
        };
    }).filter((item) => item.name || item.productId);
}

function formatDeliveryAddress(order = {}) {
    const shipping = order.shippingAddress && typeof order.shippingAddress === 'object' ? order.shippingAddress : {};
    const full = order.fullAddress && typeof order.fullAddress === 'object' ? order.fullAddress : {};
    const lines = [
        normalizeText(shipping.fullName || order.customerName),
        [
            normalizeText(shipping.village || shipping.villageName || full.village),
            normalizeText(shipping.cell || shipping.cellName || full.cell),
            normalizeText(shipping.sector || shipping.sectorName || full.sector)
        ].filter(Boolean).join(', '),
        [
            normalizeText(shipping.district || shipping.districtName || full.district),
            normalizeText(shipping.provinceCity || shipping.city || shipping.province || full.province || full.city || full.provinceCity)
        ].filter(Boolean).join(', '),
        normalizeText(shipping.country || full.country || 'Rwanda')
    ].filter(Boolean);
    return lines.join('\n');
}

function formatDeliveryNotes(order = {}) {
    const shipping = order.shippingAddress && typeof order.shippingAddress === 'object' ? order.shippingAddress : {};
    const full = order.fullAddress && typeof order.fullAddress === 'object' ? order.fullAddress : {};
    return normalizeText(
        shipping.note
        || shipping.landmark
        || full.note
        || full.landmark
        || order.note
        || order.deliveryNotes
    );
}

function resolveOrderEmailHeadline(eventKey, order = {}) {
    const orderId = normalizeText(order.orderId || order.id || order._id);
    const orderTag = orderId ? `Order #${orderId}` : '';
    const tagSuffix = orderTag ? ` — ${orderTag}` : '';

    const headlines = {
        ORDER_CREATED: {
            title: 'New Order Received',
            subject: `[BYOSE] New Order Received${tagSuffix}`,
            summary: `A new order was placed. Payment status: ${orderPaymentStatus(order) || 'Pending'}.`
        },
        PAYMENT_PENDING: {
            title: 'Payment Pending',
            subject: `[BYOSE] Payment Pending${tagSuffix}`,
            summary: `Payment is still pending for ${orderTag || 'an order'}. Current payment status: ${orderPaymentStatus(order) || 'Pending'}.`
        },
        PAYMENT_RECEIVED: {
            title: 'Payment Successful',
            subject: `[BYOSE] Payment Successful${tagSuffix}`,
            summary: `Payment has been confirmed for ${orderTag || 'an order'}.`
        },
        PAYMENT_FAILED: {
            title: 'Payment Failed',
            subject: `[BYOSE] Payment Failed${tagSuffix}`,
            summary: `A payment attempt failed for ${orderTag || 'an order'} and may need customer follow-up.`
        },
        PAYMENT_CANCELLED: {
            title: 'Payment Cancelled',
            subject: `[BYOSE] Payment Cancelled${tagSuffix}`,
            summary: `A payment attempt was cancelled for ${orderTag || 'an order'}.`
        },
        ORDER_CONFIRMED: {
            title: 'Order Confirmed',
            subject: `[BYOSE] Order Confirmed${tagSuffix}`,
            summary: `${orderTag || 'An order'} has been confirmed.`
        },
        ORDER_PROCESSING: {
            title: 'Order Processing',
            subject: `[BYOSE] Order Processing${tagSuffix}`,
            summary: `${orderTag || 'An order'} is now being processed.`
        },
        ORDER_PACKED: {
            title: 'Order Packed',
            subject: `[BYOSE] Order Packed${tagSuffix}`,
            summary: `${orderTag || 'An order'} has been packed and is awaiting shipment.`
        },
        ORDER_SHIPPED: {
            title: 'Order Shipped',
            subject: `[BYOSE] Order Shipped${tagSuffix}`,
            summary: `${orderTag || 'An order'} has been marked as shipped.`
        },
        ORDER_DELIVERED: {
            title: 'Order Delivered',
            subject: `[BYOSE] Order Delivered${tagSuffix}`,
            summary: `${orderTag || 'An order'} was marked as delivered.`
        },
        ORDER_CANCELLED: {
            title: 'Order Cancelled',
            subject: `[BYOSE] Order Cancelled${tagSuffix}`,
            summary: `${orderTag || 'An order'} was cancelled.`
        },
        REFUND_REQUESTED: {
            title: 'Refund Requested',
            subject: `[BYOSE] Refund Requested${tagSuffix}`,
            summary: `A refund or return was requested for ${orderTag || 'an order'}.`
        },
        REFUND_APPROVED: {
            title: 'Refund Completed',
            subject: `[BYOSE] Refund Completed${tagSuffix}`,
            summary: `A refund was completed for ${orderTag || 'an order'}.`
        },
        REFUND_REJECTED: {
            title: 'Refund Rejected',
            subject: `[BYOSE] Refund Rejected${tagSuffix}`,
            summary: `A refund request was rejected for ${orderTag || 'an order'}.`
        }
    };

    return headlines[eventKey] || null;
}

function buildOrderItemsHtml(items = [], currency = 'RWF') {
    if (!items.length) {
        return `<p style="margin:0;font-size:13px;color:${BRAND.muted};">No product lines were attached to this notification.</p>`;
    }

    const rows = items.map((item) => {
        const meta = [
            item.productId ? `ID: ${escapeHtml(item.productId)}` : '',
            item.sku ? `SKU: ${escapeHtml(item.sku)}` : '',
            item.variant ? escapeHtml(item.variant) : ''
        ].filter(Boolean).join(' · ');
        return `
          <tr>
            <td style="padding:10px 8px;border-bottom:1px solid ${BRAND.border};vertical-align:top;">
              <div style="font-size:14px;font-weight:600;color:${BRAND.text};">${escapeHtml(item.name)}</div>
              ${meta ? `<div style="margin-top:4px;font-size:12px;color:${BRAND.muted};">${meta}</div>` : ''}
            </td>
            <td style="padding:10px 8px;border-bottom:1px solid ${BRAND.border};text-align:center;white-space:nowrap;font-size:13px;color:${BRAND.text};">${escapeHtml(String(item.quantity))}</td>
            <td style="padding:10px 8px;border-bottom:1px solid ${BRAND.border};text-align:right;white-space:nowrap;font-size:13px;color:${BRAND.text};">${escapeHtml(money(item.unitPrice, currency))}</td>
            <td style="padding:10px 8px;border-bottom:1px solid ${BRAND.border};text-align:right;white-space:nowrap;font-size:13px;font-weight:600;color:${BRAND.text};">${escapeHtml(money(item.lineTotal, currency))}</td>
          </tr>
        `;
    }).join('');

    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BRAND.border};border-radius:10px;overflow:hidden;">
        <thead>
          <tr style="background:#f8fbfa;">
            <th align="left" style="padding:10px 8px;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND.muted};">Product</th>
            <th align="center" style="padding:10px 8px;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND.muted};">Qty</th>
            <th align="right" style="padding:10px 8px;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND.muted};">Unit</th>
            <th align="right" style="padding:10px 8px;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND.muted};">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
}

function buildOrderItemsText(items = [], currency = 'RWF') {
    if (!items.length) return ['Products: none attached'];
    return [
        'Products:',
        ...items.map((item) => {
            const meta = [item.productId && `ID ${item.productId}`, item.sku && `SKU ${item.sku}`, item.variant]
                .filter(Boolean)
                .join(' · ');
            return `- ${item.name}${meta ? ` (${meta})` : ''} x${item.quantity} @ ${money(item.unitPrice, currency)} = ${money(item.lineTotal, currency)}`;
        })
    ];
}

function sectionHtml(heading, innerHtml) {
    if (!innerHtml) return '';
    return `
      <h2 style="margin:22px 0 10px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.muted};">${escapeHtml(heading)}</h2>
      ${innerHtml}
    `;
}

function detailRows(rows = []) {
    return rows
        .filter((row) => row && row.label && row.value)
        .map((row) => {
            const safeValue = escapeHtml(row.value).replace(/\n/g, '<br />');
            return `
          <tr>
            <td style="padding:8px 0;color:${BRAND.muted};font-size:13px;width:38%;vertical-align:top;">${escapeHtml(row.label)}</td>
            <td style="padding:8px 0;color:${BRAND.text};font-size:14px;font-weight:600;vertical-align:top;">${safeValue}</td>
          </tr>
        `;
        })
        .join('');
}

function buildAdminEmailShell({
    title,
    preview,
    summary,
    details = [],
    sections = [],
    extraText = [],
    timestamp = null,
    ctaLabel = 'Open Admin Dashboard',
    ctaUrl = '',
    accent = BRAND.primary,
    footerNote = 'You received this message because admin email notifications are enabled for BYOSE Market.'
} = {}) {
    const safeTitle = escapeHtml(title);
    const safeSummary = escapeHtml(summary);
    const safePreview = escapeHtml(preview || title);
    const whenValue = timestamp || new Date();
    const when = escapeHtml(formatDateTime(whenValue));
    const buttonUrl = normalizeText(ctaUrl) || '#';
    const buttonLabel = escapeHtml(ctaLabel);
    const sectionsHtml = (Array.isArray(sections) ? sections : [])
        .filter((section) => section && section.html)
        .map((section) => sectionHtml(section.heading || '', section.html))
        .join('');

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
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${BRAND.border};border-bottom:1px solid ${BRAND.border};margin:0 0 8px;">
                ${detailRows(details)}
                <tr>
                  <td style="padding:8px 0;color:${BRAND.muted};font-size:13px;width:38%;">Date &amp; Time</td>
                  <td style="padding:8px 0;color:${BRAND.text};font-size:14px;font-weight:600;">${when}</td>
                </tr>
              </table>
              ${sectionsHtml}
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 8px;">
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
        `Date & Time: ${formatDateTime(whenValue)}`,
        '',
        ...(Array.isArray(extraText) ? extraText : []),
        '',
        `${ctaLabel}: ${buttonUrl}`,
        '',
        footerNote
    ].filter((line, index, all) => !(line === '' && all[index - 1] === '')).join('\n');

    return { html, text };
}

function eventSpecificOrderExtras(eventKey, order = {}) {
    const currency = normalizeText(order.currency, 'RWF') || 'RWF';
    const extras = [];
    const reference = safePaymentReference(order);
    const amount = Number(order.totalAmount ?? order.totalPrice ?? order.total ?? order.payment?.amount);
    const paymentTime = paymentEventTimestamp(order);

    if (String(eventKey || '').startsWith('PAYMENT_')) {
        if (reference) extras.push({ label: 'Transaction / Reference', value: reference });
        if (Number.isFinite(amount)) extras.push({ label: 'Amount', value: money(amount, currency) });
        if (eventKey === 'PAYMENT_RECEIVED' && paymentTime) {
            extras.push({ label: 'Payment Date/Time', value: formatDateTime(paymentTime) });
        }
        if (eventKey === 'PAYMENT_FAILED') {
            extras.push({ label: 'Failure Status', value: paymentFailureDetail(order) });
            if (paymentTime) extras.push({ label: 'Date/Time', value: formatDateTime(paymentTime) });
        }
        if (eventKey === 'PAYMENT_CANCELLED' && paymentTime) {
            extras.push({ label: 'Date/Time', value: formatDateTime(paymentTime) });
        }
    }

    if (eventKey === 'ORDER_CANCELLED') {
        extras.push({
            label: 'Cancellation Reason',
            value: normalizeText(order.cancellationReason || order.cancelReason)
        });
        if (paymentTime) extras.push({ label: 'Date/Time', value: formatDateTime(paymentTime) });
    }

    if (eventKey === 'ORDER_SHIPPED' || eventKey === 'ORDER_DELIVERED') {
        extras.push({
            label: eventKey === 'ORDER_DELIVERED' ? 'Delivery Date/Time' : 'Date/Time',
            value: formatDateTime(paymentTime || Date.now())
        });
    }

    return extras;
}

function orderDetails(order = {}, extras = []) {
    const currency = normalizeText(order.currency, 'RWF') || 'RWF';
    const deliveryAddress = formatDeliveryAddress(order);
    const deliveryNotes = formatDeliveryNotes(order);
    const subtotal = Number(order.subtotal);
    const discount = Number(order.couponDiscount || order.discountAmount || 0) || 0;
    const deliveryFee = Number(order.deliveryFee ?? order.shippingFee);
    const total = Number(order.totalAmount ?? order.totalPrice ?? order.total);
    return [
        { label: 'Order ID', value: normalizeText(order.orderId || order.id || order._id) },
        { label: 'Order Status', value: humanizeStatus(order.status || order.orderStatus) },
        { label: 'Payment Status', value: orderPaymentStatus(order) },
        { label: 'Payment Method', value: orderPaymentMethod(order) },
        { label: 'Customer', value: normalizeText(order.customerName || order.shippingAddress?.fullName || order.customerEmail || 'Customer') },
        { label: 'Customer Email', value: normalizeText(order.customerEmail || order.userEmail) },
        { label: 'Customer Phone', value: normalizeText(order.customerPhone || order.phoneNumber || order.shippingAddress?.phone) },
        { label: 'Subtotal', value: Number.isFinite(subtotal) ? money(subtotal, currency) : '' },
        { label: 'Discount', value: discount > 0 ? money(discount, currency) : '' },
        { label: 'Delivery Fee', value: Number.isFinite(deliveryFee) ? money(deliveryFee, currency) : '' },
        { label: 'Total Amount', value: Number.isFinite(total) ? money(total, currency) : money(order.totalAmount || order.totalPrice, currency) },
        { label: 'Delivery Address', value: deliveryAddress },
        { label: 'City / Location', value: normalizeText(order.shippingAddress?.provinceCity || order.shippingAddress?.city || order.shippingAddress?.district || order.fullAddress?.city || order.fullAddress?.province) },
        { label: 'Delivery Notes', value: deliveryNotes },
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
    PAYMENT_PENDING: {
        title: 'Payment Pending',
        accent: BRAND.warning,
        ctaLabel: 'Inspect Order',
        ctaRoute: 'orders',
        summary: () => 'Payment is still pending for an order.'
    },
    PAYMENT_RECEIVED: {
        title: 'Payment Successful',
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
    PAYMENT_CANCELLED: {
        title: 'Payment Cancelled',
        accent: BRAND.warning,
        ctaLabel: 'Inspect Order',
        ctaRoute: 'orders',
        summary: () => 'A payment attempt was cancelled.'
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
        title: 'Refund Completed',
        accent: BRAND.primary,
        ctaLabel: 'View Refund',
        ctaRoute: 'orders',
        summary: () => 'A refund request was completed.'
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
    const headline = resolveOrderEmailHeadline(eventKey, order);

    let details = [];
    let relatedId = '';
    let sections = [];
    let extraText = [];
    const currency = normalizeText(order.currency, 'RWF') || 'RWF';

    if (eventKey.startsWith('ORDER_') || eventKey.startsWith('PAYMENT_') || eventKey.startsWith('REFUND_')) {
        details = orderDetails(order, eventSpecificOrderExtras(eventKey, order));
        relatedId = normalizeText(order.orderId || order.id || order._id || notification.relatedOrderId);
        const items = collectOrderItems(order);
        sections = [
            {
                heading: 'Ordered Products',
                html: buildOrderItemsHtml(items, currency)
            }
        ];
        extraText = buildOrderItemsText(items, currency);
    } else if (eventKey === 'CUSTOMER_REGISTERED') {
        details = customerDetails(customer);
        relatedId = normalizeText(customer.id || customer._id);
    } else if (eventKey === 'LOW_STOCK' || eventKey === 'OUT_OF_STOCK') {
        details = productDetails(product, [
            { label: 'Alert Level', value: eventKey === 'OUT_OF_STOCK' ? 'Out of stock' : 'Low stock' }
        ]);
        relatedId = normalizeText(product.catalogId || product.id);
    }

    const summary = headline?.summary
        || (typeof def.summary === 'function' ? def.summary(context) : '')
        || normalizeText(notification.message || def.title);
    const title = headline?.title || def.title;
    const subject = headline?.subject || `[BYOSE] ${def.title}${relatedId ? ` — ${relatedId}` : ''}`;

    const ctaUrl = resolveAdminCtaUrl(appBaseUrl, def.ctaRoute, relatedId);
    const shell = buildAdminEmailShell({
        title,
        preview: normalizeText(notification.message || summary),
        summary: normalizeText(summary),
        details,
        sections,
        extraText,
        timestamp: (eventKey === 'ORDER_CREATED'
            ? (order.createdAt || order.created_at || notification.createdAt)
            : (order.updatedAt || order.payment?.gateway?.verifiedAt || order.createdAt || notification.createdAt)) || null,
        ctaLabel: def.ctaLabel,
        ctaUrl,
        accent: def.accent
    });

    return {
        subject,
        html: shell.html,
        text: shell.text,
        eventKey,
        ctaUrl,
        title
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
    resolveOrderEmailHeadline,
    collectOrderItems,
    escapeHtml
};
