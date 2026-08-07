import { badge, emptyState, formatCurrency, formatDate, panel } from "../components/ui.js";
import { getOrders, updateOrderStatus } from "../services/admin-data.service.js";
import { openPrintableReport } from "../services/enterprise-intelligence.service.js";
import { subscribeToLiveFeeds } from "../services/live-feeds.service.js";

const STATUS_OPTIONS = [
  "Pending",
  "Confirmed",
  "Processing",
  "Packed",
  "Shipping",
  "Delivered",
  "Cancelled",
  "Returned",
  "Refunded"
];

const PAGE_SIZE = 10;
const TIMELINE_STAGES = [
  { key: "created", label: "Created", match: /pending|creat|received|order/i },
  { key: "confirmed", label: "Confirmed", match: /confirm|accept|paid/i },
  { key: "processing", label: "Processing", match: /process/i },
  { key: "packed", label: "Packed", match: /pack/i },
  { key: "shipped", label: "Shipped", match: /ship/i },
  { key: "out_for_delivery", label: "Out for Delivery", match: /out for delivery|out_for_delivery/i },
  { key: "delivered", label: "Delivered", match: /deliver/i },
  { key: "completed", label: "Completed", match: /complete/i },
  { key: "cancelled", label: "Cancelled", match: /cancel/i },
  { key: "returned", label: "Returned", match: /return/i },
  { key: "refunded", label: "Refunded", match: /refund/i }
];

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function statusTone(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("deliver") || value.includes("complete") || value.includes("paid")) return "success";
  if (value.includes("cancel") || value.includes("return") || value.includes("refund")) return "danger";
  if (value.includes("ship") || value.includes("confirm") || value.includes("pack") || value.includes("process")) return "warn";
  return "neutral";
}

function paymentLabel(order) {
  if (order?.paymentMethod === "cod" || String(order?.paymentMethodLabel || "").toLowerCase().includes("cash")) {
    return "Cash on Delivery";
  }
  return order?.paymentMethodLabel || order?.paymentMethod || "—";
}

function readHashQuery() {
  const hash = String(window.location.hash || "");
  const queryIndex = hash.indexOf("?");
  if (queryIndex < 0) return new URLSearchParams();
  return new URLSearchParams(hash.slice(queryIndex + 1));
}

function resolveMapLink(order) {
  const gps = order?.gpsLocation || {};
  const ship = order?.shippingAddress || {};
  const lat = gps.latitude || ship.latitude;
  const lng = gps.longitude || ship.longitude;
  const explicit = gps.googleMapsLink || gps.mapLink || ship.mapLink || "";
  if (explicit) return explicit;
  if (lat != null && lat !== "" && lng != null && lng !== "") {
    return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;
  }
  return "";
}

function matchesNavStatus(order, filter) {
  const status = String(order?.status || "").toLowerCase();
  const payment = String(order?.paymentStatus || order?.paymentStatusLabel || "").toLowerCase();
  const raw = String(filter || "").trim().toLowerCase();
  if (!raw) return true;

  if (raw.startsWith("status:")) {
    return status === raw.slice("status:".length);
  }

  switch (raw) {
    case "pending": {
      // Pending = unaccepted/unfulfilled only. Never overlap completed/cancelled/returns.
      if (
        status.includes("cancel")
        || status.includes("return")
        || status.includes("refund")
        || status.includes("deliver")
        || status.includes("complete")
        || status.includes("ship")
        || status.includes("pack")
        || status.includes("process")
        || status.includes("confirm")
      ) {
        return false;
      }
      return status === "pending"
        || payment.includes("awaiting_payment")
        || payment.includes("awaiting payment")
        || payment.includes("awaiting_delivery_payment");
    }
    case "completed":
      // Completed = delivered / finished fulfillment only (exclude terminal return/cancel paths).
      if (status.includes("cancel") || status.includes("return") || status.includes("refund")) {
        return false;
      }
      return status === "delivered" || status === "completed" || status.includes("deliver") || status.includes("complete");
    case "cancelled":
      return status.includes("cancel");
    case "returns": {
      // Only real return/refund signals — never fall back to generic paymentStatus.
      const workflow = order?.returnWorkflow || {};
      const returnStatus = String(workflow.returnStatus || order?.returnStatus || "").toLowerCase();
      const refundStatus = String(workflow.refundStatus || order?.refundStatus || "").toLowerCase();
      const hasReturnWorkflow = Boolean(returnStatus || refundStatus);
      const needsRefund = Boolean(order?.refundRequired)
        || payment.includes("refund_required")
        || refundStatus === "required"
        || refundStatus === "pending";
      return status.includes("return")
        || status.includes("refund")
        || needsRefund
        || hasReturnWorkflow;
    }
    default:
      return status === raw || status.includes(raw);
  }
}

function resolveCompletionDate(order) {
  const history = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index] || {};
    if (/deliver|complete/i.test(`${entry.status || ""} ${entry.label || ""}`)) {
      return entry.timestamp || "";
    }
  }
  if (/deliver|complete/i.test(String(order?.status || ""))) {
    return order.updatedAt || order.date || order.createdAt || "";
  }
  return "";
}

function resolveCancellationDate(order) {
  if (order?.cancelledAt) return order.cancelledAt;
  const history = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index] || {};
    if (/cancel/i.test(`${entry.status || ""} ${entry.label || ""}`)) {
      return entry.timestamp || "";
    }
  }
  if (/cancel/i.test(String(order?.status || ""))) {
    return order.updatedAt || order.date || "";
  }
  return "";
}

function resolveCancelledBy(order) {
  const explicit = String(order?.cancelledBy || order?.paymentCancellation?.cancelledBy || "").trim();
  if (explicit) return explicit;
  const history = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index] || {};
    if (/cancel/i.test(`${entry.status || ""} ${entry.label || ""}`) && entry.actor) {
      return entry.actor;
    }
  }
  return "Unknown";
}

function resolveCancellationReason(order) {
  return String(
    order?.cancellationReason
    || order?.paymentCancellation?.reason
    || [...(order?.statusHistory || [])].reverse().find((entry) => /cancel/i.test(`${entry?.status || ""} ${entry?.label || ""}`))?.reason
    || [...(order?.statusHistory || [])].reverse().find((entry) => /cancel/i.test(`${entry?.status || ""} ${entry?.label || ""}`))?.note
    || ""
  ).trim();
}

function resolveReturnRequestDate(order) {
  const workflow = order?.returnWorkflow || {};
  if (workflow.returnRequestedAt) return workflow.returnRequestedAt;
  const history = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index] || {};
    if (/return/i.test(`${entry.status || ""} ${entry.label || ""}`)) {
      return entry.timestamp || "";
    }
  }
  return order?.cancelledAt || "";
}

function resolveRefundDate(order) {
  const workflow = order?.returnWorkflow || {};
  return workflow.refundDate || workflow.refundApprovedAt || "";
}

function formatReturnStatusLabel(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "Not started";
  if (raw === "requested") return "Requested";
  if (raw === "approved") return "Approved";
  if (raw === "rejected") return "Rejected";
  if (raw === "received") return "Received";
  return String(value);
}

function formatRefundStatusLabel(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "Not required";
  if (raw === "required" || raw === "pending") return "Required";
  if (raw === "completed" || raw === "refunded") return "Completed";
  if (raw === "rejected") return "Rejected";
  return String(value);
}

function getReturnWorkflow(order) {
  return order?.returnWorkflow && typeof order.returnWorkflow === "object" ? order.returnWorkflow : {};
}

function dedupeOrdersById(orders) {
  const seen = new Set();
  return (Array.isArray(orders) ? orders : []).filter((order) => {
    const id = String(order?.orderId || order?.id || "").trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function getOrdersViewMeta(statusFilter) {
  const filter = String(statusFilter || "").trim().toLowerCase();
  if (filter === "pending") {
    return {
      mode: "pending",
      title: "Pending Orders",
      eyebrow: "Fulfillment queue",
      description: "New checkout orders awaiting acceptance. Accept or start processing to move them through the workflow."
    };
  }
  if (filter === "completed") {
    return {
      mode: "completed",
      title: "Completed Orders",
      eyebrow: "Completed fulfillment",
      description: "Delivered and completed orders preserved permanently with full checkout, payment, delivery, and product records."
    };
  }
  if (filter === "cancelled") {
    return {
      mode: "cancelled",
      title: "Cancelled Orders",
      eyebrow: "Cancellation desk",
      description: "Orders cancelled by customers or administrators. Stock is restored automatically and paid cancellations are prepared for Returns & Refunds."
    };
  }
  if (filter === "returns") {
    return {
      mode: "returns",
      title: "Returns & Refunds",
      eyebrow: "Return & refund desk",
      description: "Manage product returns and customer refund requests. Only qualifying orders appear here, linked permanently to their original checkout records."
    };
  }
  return {
    mode: "all",
    title: "All Orders",
    eyebrow: "Orders",
    description: "Central order management synchronized with checkout, payment, GPS, and fulfillment."
  };
}

function filterAndSortOrders(orders, state) {
  const query = String(state.query || "").trim().toLowerCase();
  const paymentFilter = String(state.paymentFilter || "").trim().toLowerCase();
  const cancelledByFilter = String(state.cancelledByFilter || "").trim().toLowerCase();
  const returnStatusFilter = String(state.returnStatusFilter || "").trim().toLowerCase();
  const refundStatusFilter = String(state.refundStatusFilter || "").trim().toLowerCase();
  let list = dedupeOrdersById(orders).filter((order) => matchesNavStatus(order, state.statusFilter));

  if (paymentFilter) {
    list = list.filter((order) => {
      const method = String(order.paymentMethod || order.paymentMethodLabel || "").toLowerCase();
      if (paymentFilter === "cod") {
        return method.includes("cod") || method.includes("cash");
      }
      return method.includes(paymentFilter);
    });
  }

  if (cancelledByFilter) {
    list = list.filter((order) => String(resolveCancelledBy(order) || "").toLowerCase().includes(cancelledByFilter));
  }

  if (returnStatusFilter) {
    list = list.filter((order) => {
      const value = String(getReturnWorkflow(order).returnStatus || order.returnStatus || "").toLowerCase();
      return value === returnStatusFilter || value.includes(returnStatusFilter);
    });
  }

  if (refundStatusFilter) {
    list = list.filter((order) => {
      const workflow = getReturnWorkflow(order);
      const value = String(workflow.refundStatus || order.refundStatus || order.paymentStatus || "").toLowerCase();
      if (refundStatusFilter === "required") {
        return value.includes("required") || value.includes("pending") || Boolean(order.refundRequired);
      }
      if (refundStatusFilter === "completed") {
        return value.includes("completed") || value.includes("refunded");
      }
      return value === refundStatusFilter || value.includes(refundStatusFilter);
    });
  }

  if (query) {
    list = list.filter((order) => {
      const ship = order.shippingAddress || {};
      const workflow = getReturnWorkflow(order);
      const haystack = [
        order.orderId,
        order.customerName,
        order.customerPhone,
        order.customerEmail,
        order.paymentMethod,
        order.paymentMethodLabel,
        order.status,
        workflow.returnReason,
        workflow.returnStatus,
        workflow.refundStatus,
        ship.provinceCity,
        ship.district,
        ship.sector,
        ship.village,
        resolveCompletionDate(order),
        resolveReturnRequestDate(order),
        ...(order.items || []).map((item) => item.productName),
        ...(order.items || []).map((item) => item.sku)
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }

  const sort = state.sort || "date-desc";
  list = [...list].sort((a, b) => {
    if (sort === "return-desc") {
      return new Date(resolveReturnRequestDate(b) || b.date || 0) - new Date(resolveReturnRequestDate(a) || a.date || 0);
    }
    if (sort === "return-asc") {
      return new Date(resolveReturnRequestDate(a) || a.date || 0) - new Date(resolveReturnRequestDate(b) || b.date || 0);
    }
    if (sort === "cancelled-desc") {
      return new Date(resolveCancellationDate(b) || b.date || 0) - new Date(resolveCancellationDate(a) || a.date || 0);
    }
    if (sort === "cancelled-asc") {
      return new Date(resolveCancellationDate(a) || a.date || 0) - new Date(resolveCancellationDate(b) || b.date || 0);
    }
    if (sort === "completed-desc") {
      return new Date(resolveCompletionDate(b) || b.date || 0) - new Date(resolveCompletionDate(a) || a.date || 0);
    }
    if (sort === "completed-asc") {
      return new Date(resolveCompletionDate(a) || a.date || 0) - new Date(resolveCompletionDate(b) || b.date || 0);
    }
    if (sort === "date-asc") {
      return new Date(a.date || 0) - new Date(b.date || 0);
    }
    if (sort === "total-desc") {
      return (Number(b.total) || 0) - (Number(a.total) || 0);
    }
    if (sort === "total-asc") {
      return (Number(a.total) || 0) - (Number(b.total) || 0);
    }
    if (sort === "status") {
      return String(a.status || "").localeCompare(String(b.status || ""));
    }
    return new Date(b.date || 0) - new Date(a.date || 0);
  });

  return list;
}

function renderInfoGrid(rows) {
  return `
    <div class="orders-info-grid">
      ${rows.filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
        .map(([label, value]) => `
          <div>
            <span>${escapeHtml(label)}</span>
            <strong>${typeof value === "object" && value?.html ? value.html : escapeHtml(value)}</strong>
          </div>
        `).join("")}
    </div>
  `;
}

function renderCustomerBlock(order) {
  const ship = order.shippingAddress || {};
  const full = order.fullAddress || {};
  const phone = ship.phone || order.customerPhone || "";
  const email = order.customerEmail || "";
  const mapLink = resolveMapLink(order);
  const gps = order.gpsLocation || {};

  return `
    <div class="orders-detail-card">
      <h4>Customer Information</h4>
      ${renderInfoGrid([
        ["Full Name", ship.fullName || order.customerName],
        ["Phone Number", phone
          ? { html: `<a class="orders-inline-link" href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a>` }
          : "—"],
        ["Email", email
          ? { html: `<a class="orders-inline-link" href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` }
          : ""],
        ["Province / City", ship.provinceCity || full.province],
        ["District", ship.district || full.district],
        ["Sector", ship.sector || full.sector],
        ["Cell", ship.cell || full.cell],
        ["Village", ship.village || full.village],
        ["Landmark / Note", ship.note || full.note || full.street],
        ["Latitude", gps.latitude || ship.latitude],
        ["Longitude", gps.longitude || ship.longitude]
      ])}
      ${mapLink ? `<p class="orders-inline-link-wrap"><a class="orders-inline-link" href="${escapeHtml(mapLink)}" target="_blank" rel="noopener">Open Customer Location in Google Maps</a></p>` : ""}
    </div>
  `;
}

function renderOrderInfoBlock(order, viewMode = "all") {
  const paymentStatus = order.paymentStatusLabel || order.paymentStatus || "Pending";
  const completionDate = resolveCompletionDate(order);
  const cancellationDate = resolveCancellationDate(order);
  const workflow = getReturnWorkflow(order);
  const returnRequestDate = resolveReturnRequestDate(order);
  const refundDate = resolveRefundDate(order);
  return `
    <div class="orders-detail-card">
      <h4>Order Information</h4>
      ${renderInfoGrid([
        ["Order Number", order.orderId || order.id],
        ["Order Date", formatDate(order.date || order.createdAt)],
        viewMode === "completed" || viewMode === "returns" || completionDate ? ["Delivery Date", completionDate ? formatDate(completionDate) : "—"] : null,
        viewMode === "completed" || completionDate ? ["Completion Date", completionDate ? formatDate(completionDate) : "—"] : null,
        viewMode === "cancelled" || cancellationDate ? ["Cancellation Date", cancellationDate ? formatDate(cancellationDate) : "—"] : null,
        viewMode === "cancelled" ? ["Cancelled By", resolveCancelledBy(order)] : null,
        viewMode === "cancelled" ? ["Cancellation Reason", resolveCancellationReason(order) || "—"] : null,
        viewMode === "cancelled" && order.refundRequired ? ["Refund Workflow", "Prepared for Returns & Refunds"] : null,
        viewMode === "returns" ? ["Return Request Date", returnRequestDate ? formatDate(returnRequestDate) : "—"] : null,
        viewMode === "returns" ? ["Return Status", formatReturnStatusLabel(workflow.returnStatus || order.returnStatus)] : null,
        viewMode === "returns" ? ["Refund Status", formatRefundStatusLabel(workflow.refundStatus || order.refundStatus || (order.refundRequired ? "required" : ""))] : null,
        ["Order Status", order.status || order.orderStatus || "Pending"],
        ["Payment Status", paymentStatus],
        ["Payment Method", paymentLabel(order)],
        ["Payer Phone", order.payerPhone],
        ["Payment Note", order.paymentNote],
        ["Shipping Method", order.deliveryLabel || order.deliveryMethod || "Home delivery"],
        ["Shipping Status", order.shippingStatus || order.status],
        ["Delivery Status", order.deliveryStatus || order.status],
        ["Subtotal", formatCurrency(order.subtotal || 0)],
        ["Shipping Cost", formatCurrency(order.shippingCost || order.deliveryFee || 0)],
        ["Discount", Number(order.discount) > 0 ? formatCurrency(order.discount) : ""],
        ["Tax", Number(order.tax) > 0 ? formatCurrency(order.tax) : ""],
        Number(order.codFee) > 0 ? ["COD Fee", formatCurrency(order.codFee)] : null,
        ["Grand Total", formatCurrency(order.grandTotal || order.total || 0)],
        viewMode === "returns" && refundDate ? ["Refund Date", formatDate(refundDate)] : null
      ].filter(Boolean))}
    </div>
  `;
}

function renderReturnInfoBlock(order) {
  const workflow = getReturnWorkflow(order);
  const images = Array.isArray(workflow.returnImages) ? workflow.returnImages : [];
  const refundAmount = Number(workflow.refundAmount || order.refundAmount || 0);
  const showAmount = refundAmount > 0 || String(workflow.refundStatus || "").toLowerCase() === "completed";
  return `
    <div class="orders-detail-card">
      <h4>Return Information</h4>
      ${renderInfoGrid([
        ["Return Reason", workflow.returnReason || order.returnReason || resolveCancellationReason(order) || "—"],
        ["Customer Notes", workflow.customerNotes || "—"],
        ["Admin Notes", workflow.adminNotes || "—"],
        ["Product Condition", workflow.productCondition || "—"],
        ["Return Approval Status", formatReturnStatusLabel(workflow.returnStatus || order.returnStatus)],
        ["Refund Status", formatRefundStatusLabel(workflow.refundStatus || order.refundStatus || (order.refundRequired ? "required" : ""))],
        ["Refund Amount", showAmount ? formatCurrency(refundAmount || order.total || 0) : "Pending approval"],
        ["Refund Method", workflow.refundMethod || order.refundMethod || paymentLabel(order)],
        ["Refund Date", resolveRefundDate(order) ? formatDate(resolveRefundDate(order)) : "—"],
        ["Return Request Date", resolveReturnRequestDate(order) ? formatDate(resolveReturnRequestDate(order)) : "—"]
      ])}
      ${images.length ? `
        <div class="orders-return-images">
          <span>Uploaded Return Images</span>
          <div class="orders-return-images__grid">
            ${images.map((src) => {
              const resolved = resolveProductImage({ image: src });
              return resolved
                ? `<a href="${escapeHtml(resolved)}" target="_blank" rel="noopener"><img src="${escapeHtml(resolved)}" alt="Return evidence" loading="lazy"></a>`
                : "";
            }).join("")}
          </div>
        </div>
      ` : `<p class="orders-empty-state">No return images uploaded.</p>`}
    </div>
  `;
}

function renderDeliveryBlock(order) {
  const ship = order.shippingAddress || {};
  const full = order.fullAddress || {};
  const mapLink = resolveMapLink(order);
  return `
    <div class="orders-detail-card">
      <h4>Delivery Information</h4>
      ${renderInfoGrid([
        ["Delivery Status", order.deliveryStatus || order.status],
        ["Shipping Method", order.deliveryLabel || order.deliveryMethod || "Home delivery"],
        ["Recipient", ship.fullName || order.customerName],
        ["Phone", ship.phone || order.customerPhone],
        ["Province / City", ship.provinceCity || full.province],
        ["District", ship.district || full.district],
        ["Sector", ship.sector || full.sector],
        ["Cell", ship.cell || full.cell],
        ["Village", ship.village || full.village],
        ["Landmark / Note", ship.note || full.note],
        ["Completion Date", resolveCompletionDate(order) ? formatDate(resolveCompletionDate(order)) : ""]
      ])}
      ${mapLink ? `<p class="orders-inline-link-wrap"><a class="orders-inline-link" href="${escapeHtml(mapLink)}" target="_blank" rel="noopener">Open Customer Location in Google Maps</a></p>` : ""}
    </div>
  `;
}

function renderGps(order) {
  const mapLink = resolveMapLink(order);
  const gps = order?.gpsLocation || {};
  const lat = gps.latitude || order?.shippingAddress?.latitude;
  const lng = gps.longitude || order?.shippingAddress?.longitude;
  if (!mapLink && (lat == null || lat === "" || lng == null || lng === "")) return "";
  return `
    <p class="orders-inline-link-wrap">
      ${mapLink ? `<a class="orders-inline-link" href="${escapeHtml(mapLink)}" target="_blank" rel="noopener">Open GPS on Maps</a>` : ""}
      ${lat != null && lat !== "" && lng != null && lng !== "" ? `<small>(${escapeHtml(lat)}, ${escapeHtml(lng)})</small>` : ""}
    </p>
  `;
}

function resolveProductImage(item) {
  const value = String(item?.image || item?.colorImage || "").trim();
  if (!value) return "";
  if (/^(?:https?:|data:|blob:)/i.test(value)) return value;
  if (value.startsWith("/uploads/") || value.startsWith("/img/")) return value;
  if (value.startsWith("uploads/") || value.startsWith("img/")) return `/${value}`;
  if (/^(?:products|categories|users|reviews|hero|temp)\//i.test(value)) return `/uploads/${value}`;
  if (value.startsWith("/")) return value;
  return value;
}

function renderProductCard(item) {
  const imageSrc = resolveProductImage(item);
  const image = imageSrc
    ? `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(item.productName || "Product")}" loading="lazy">`
    : `<div class="order-product-ph" aria-hidden="true"></div>`;
  const variant = item?.attributeSummary || [item?.color, item?.size].filter(Boolean).join(" · ");
  const link = item?.productUrl
    ? `<a class="orders-inline-link" href="${escapeHtml(item.productUrl)}" target="_blank" rel="noopener">View product</a>`
    : "";

  return `
    <article class="order-product-card">
      ${image}
      <div class="order-product-copy">
        <div class="order-product-heading">
          <div>
            <h3>${escapeHtml(item?.productName || "Product")}</h3>
            ${variant ? `<p>${escapeHtml(variant)}</p>` : ""}
          </div>
          <strong>${formatCurrency(item?.lineTotal || ((Number(item?.price) || 0) * (Number(item?.quantity) || 1)))}</strong>
        </div>
        <div class="order-product-meta">
          <div><span>SKU</span><strong>${escapeHtml(item?.sku || "—")}</strong></div>
          <div><span>Color</span><strong>${escapeHtml(item?.color || "—")}</strong></div>
          <div><span>Size</span><strong>${escapeHtml(item?.size || "—")}</strong></div>
          <div><span>Qty</span><strong>${escapeHtml(item?.quantity || 1)}</strong></div>
          <div><span>Unit price</span><strong>${formatCurrency(item?.price || 0)}</strong></div>
          <div><span>Total price</span><strong>${formatCurrency(item?.lineTotal || ((Number(item?.price) || 0) * (Number(item?.quantity) || 1)))}</strong></div>
        </div>
        ${link}
      </div>
    </article>
  `;
}

function buildTimelineEvents(order, viewMode = "all") {
  const history = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
  const events = [];
  const completionDate = resolveCompletionDate(order);

  events.push({
    label: "Created",
    timestamp: order.createdAt || order.date,
    tone: "done"
  });

  history.forEach((entry) => {
    const label = entry.label || entry.status || "Update";
    if (/creat|received|pending/i.test(label) && events.length === 1) return;
    events.push({
      label,
      note: entry.note,
      timestamp: entry.timestamp,
      tone: statusTone(entry.status || entry.label)
    });
  });

  const current = String(order.status || "").toLowerCase();
  const stages = viewMode === "completed"
    ? TIMELINE_STAGES.filter((stage) => !["cancelled", "returned", "refunded"].includes(stage.key))
    : viewMode === "cancelled"
      ? TIMELINE_STAGES.filter((stage) => ["created", "confirmed", "processing", "packed", "shipped", "cancelled"].includes(stage.key))
      : viewMode === "returns"
        ? TIMELINE_STAGES.filter((stage) => ["created", "confirmed", "processing", "shipped", "delivered", "completed", "cancelled", "returned", "refunded"].includes(stage.key))
        : TIMELINE_STAGES;

  stages.forEach((stage) => {
    if (stage.key === "created") return;
    const already = events.some((event) => stage.match.test(String(event.label || "")));
    if (already) return;
    if (stage.match.test(current) || (stage.key === "completed" && /deliver|complete/.test(current))) {
      events.push({
        label: stage.label,
        timestamp: stage.key === "delivered" || stage.key === "completed" ? (completionDate || order.date) : order.date,
        tone: "current"
      });
    }
  });

  if (viewMode === "completed" && !events.some((event) => /complete/i.test(String(event.label || ""))) && /deliver|complete/.test(current)) {
    events.push({
      label: "Completed",
      timestamp: completionDate || order.date,
      tone: "success"
    });
  }

  return events;
}

function renderTimeline(order, viewMode = "all") {
  const events = buildTimelineEvents(order, viewMode);
  return `
    <div class="orders-detail-card">
      <h4>Order Timeline</h4>
      <ol class="orders-timeline">
        ${events.map((event) => `
          <li class="orders-timeline__item" data-tone="${escapeHtml(event.tone || "neutral")}">
            <strong>${escapeHtml(event.label)}</strong>
            ${event.note ? `<span>${escapeHtml(event.note)}</span>` : ""}
            <small>${event.timestamp ? formatDate(event.timestamp) : ""}</small>
          </li>
        `).join("")}
      </ol>
    </div>
  `;
}

function renderStatusSelect(order) {
  const current = String(order.status || order.orderStatus || "Pending");
  const options = STATUS_OPTIONS.map((status) => (
    `<option value="${escapeHtml(status)}" ${status.toLowerCase() === current.toLowerCase() ? "selected" : ""}>${escapeHtml(status)}</option>`
  )).join("");

  return `
    <label class="orders-status-control">
      <span>Update Order Status</span>
      <select data-order-status="${escapeHtml(order.orderId || order.id)}">${options}</select>
    </label>
  `;
}

function renderActions(order, viewMode = "all") {
  const id = escapeHtml(order.orderId || order.id);
  const phone = escapeHtml(order.customerPhone || order.shippingAddress?.phone || "");
  const email = escapeHtml(order.customerEmail || "");
  const mapLink = resolveMapLink(order);
  const isPendingView = viewMode === "pending";
  const isCompletedView = viewMode === "completed";
  const isCancelledView = viewMode === "cancelled";
  const isReturnsView = viewMode === "returns";
  const workflow = getReturnWorkflow(order);
  const returnStatus = String(workflow.returnStatus || "").toLowerCase();
  const refundStatus = String(workflow.refundStatus || order.paymentStatus || "").toLowerCase();
  const refundDone = refundStatus === "completed" || refundStatus === "refunded" || String(order.paymentStatus || "").toLowerCase() === "refunded";
  const returnRejected = returnStatus === "rejected";
  const returnApproved = returnStatus === "approved" || returnStatus === "received";
  const canOpenReturn = !returnApproved && !refundDone && returnStatus !== "requested" && !returnRejected;
  const canApproveReturn = (returnStatus === "requested" || (!returnStatus && order.refundRequired)) && !returnApproved && !returnRejected && !refundDone;
  const canRejectReturn = (returnStatus === "requested" || (!returnStatus && order.refundRequired)) && !returnApproved && !refundDone;
  const canApproveRefund = !refundDone && refundStatus !== "rejected" && (order.refundRequired || returnApproved || refundStatus === "required" || refundStatus === "pending" || String(order.paymentStatus || "").toLowerCase().includes("refund_required"));
  const canRejectRefund = canApproveRefund;

  return `
    <div class="orders-actions-inline" data-order-actions="${id}">
      <button type="button" class="orders-secondary-link" data-order-action="toggle" data-order-id="${id}">${isReturnsView ? "View Complete Return" : "View Complete Order"}</button>
      ${isPendingView ? `
        <button type="button" class="orders-secondary-link orders-action--primary" data-order-action="accept" data-order-id="${id}">Accept Order</button>
        <button type="button" class="orders-secondary-link orders-action--primary" data-order-action="process" data-order-id="${id}">Start Processing</button>
      ` : ""}
      ${isCompletedView || isCancelledView || isReturnsView ? `
        <button type="button" class="orders-secondary-link" data-order-action="customer" data-order-id="${id}">View Customer Details</button>
      ` : ""}
      ${isCompletedView ? `
        <button type="button" class="orders-secondary-link" data-order-action="delivery" data-order-id="${id}">View Delivery Information</button>
      ` : ""}
      ${isCancelledView ? `
        <button type="button" class="orders-secondary-link" data-order-action="cancellation-reason" data-order-id="${id}">View Cancellation Reason</button>
        <button type="button" class="orders-secondary-link orders-action--primary" data-order-action="restore" data-order-id="${id}">Restore Order</button>
        <button type="button" class="orders-secondary-link" data-order-action="summary" data-order-id="${id}">Print Order Summary</button>
        ${order.refundRequired ? `<a class="orders-secondary-link" href="#/orders?status=returns">Open Returns &amp; Refunds</a>` : ""}
      ` : ""}
      ${isReturnsView ? `
        <a class="orders-secondary-link" href="#/orders" data-order-action="view-original" data-order-id="${id}">View Original Order</a>
        ${canOpenReturn ? `<button type="button" class="orders-secondary-link orders-action--primary" data-order-action="open-return" data-order-id="${id}">Open Return Request</button>` : ""}
        ${canApproveReturn ? `<button type="button" class="orders-secondary-link orders-action--primary" data-order-action="approve-return" data-order-id="${id}">Approve Return</button>` : ""}
        ${canRejectReturn ? `<button type="button" class="orders-danger-button" data-order-action="reject-return" data-order-id="${id}">Reject Return</button>` : ""}
        ${canApproveRefund ? `<button type="button" class="orders-secondary-link orders-action--primary" data-order-action="approve-refund" data-order-id="${id}">Approve Refund</button>` : ""}
        ${canRejectRefund ? `<button type="button" class="orders-danger-button" data-order-action="reject-refund" data-order-id="${id}">Reject Refund</button>` : ""}
        <button type="button" class="orders-secondary-link" data-order-action="print-return" data-order-id="${id}">Print Return Report</button>
        <button type="button" class="orders-secondary-link" data-order-action="print-refund" data-order-id="${id}">Print Refund Report</button>
      ` : ""}
      ${isReturnsView ? "" : `<button type="button" class="orders-secondary-link" data-order-action="invoice" data-order-id="${id}">Print Invoice</button>`}
      ${isCompletedView ? `
        <button type="button" class="orders-secondary-link" data-order-action="receipt" data-order-id="${id}">Print Receipt</button>
        <button type="button" class="orders-secondary-link" data-order-action="download-invoice" data-order-id="${id}">Download Invoice (PDF)</button>
      ` : ""}
      ${isReturnsView ? "" : `<button type="button" class="orders-secondary-link" data-order-action="packing" data-order-id="${id}">Print Packing Slip</button>`}
      ${phone ? `<a class="orders-secondary-link" href="tel:${phone}">Contact Customer</a>` : ""}
      ${email ? `<a class="orders-secondary-link" href="mailto:${email}">Email Customer</a>` : ""}
      ${mapLink ? `<a class="orders-secondary-link" href="${escapeHtml(mapLink)}" target="_blank" rel="noopener">Open Customer Location in Google Maps</a>` : ""}
      <button type="button" class="orders-secondary-link" data-order-action="payment" data-order-id="${id}">View Payment Details</button>
      ${isPendingView ? `
        <button type="button" class="orders-danger-button" data-order-action="cancel" data-order-id="${id}">Cancel Order</button>
      ` : ""}
    </div>
  `;
}

function renderOrderCard(order, { expanded = false, viewMode = "all" } = {}) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const paymentStatus = order?.paymentStatusLabel || order?.paymentStatus || "Pending";
  const completionDate = resolveCompletionDate(order);
  const cancellationDate = resolveCancellationDate(order);
  const workflow = getReturnWorkflow(order);
  const returnRequestDate = resolveReturnRequestDate(order);
  const returnLabel = formatReturnStatusLabel(workflow.returnStatus || order.returnStatus);
  const refundLabel = formatRefundStatusLabel(workflow.refundStatus || order.refundStatus || (order.refundRequired ? "required" : ""));

  return `
    <article class="order-mobile-card${expanded ? " is-expanded" : ""}" data-order-id="${escapeHtml(order.orderId || order.id)}">
      <div class="order-mobile-head">
        <div>
          <h3>${escapeHtml(order.orderId || order.id)}</h3>
          <p>${formatDate(order.date)}${viewMode === "completed" && completionDate ? ` · Completed ${formatDate(completionDate)}` : ""}${viewMode === "cancelled" && cancellationDate ? ` · Cancelled ${formatDate(cancellationDate)}` : ""}${viewMode === "returns" && returnRequestDate ? ` · Return ${formatDate(returnRequestDate)}` : ""}</p>
        </div>
        ${badge(viewMode === "returns" ? refundLabel : String(order.status || "Pending"), statusTone(viewMode === "returns" ? refundLabel : order.status))}
      </div>
      <div class="order-mobile-meta">
        <div><span>Customer</span><strong>${escapeHtml(order.customerName)}</strong></div>
        <div><span>Phone</span><strong>${escapeHtml(order.customerPhone || "—")}</strong></div>
        <div><span>Payment</span><strong>${escapeHtml(paymentLabel(order))}</strong></div>
        <div><span>Payment status</span><strong>${escapeHtml(paymentStatus)}</strong></div>
        ${viewMode === "cancelled" ? `<div><span>Cancelled by</span><strong>${escapeHtml(resolveCancelledBy(order))}</strong></div>` : ""}
        ${viewMode === "returns" ? `<div><span>Return status</span><strong>${escapeHtml(returnLabel)}</strong></div>` : ""}
        ${viewMode === "returns" ? `<div><span>Refund status</span><strong>${escapeHtml(refundLabel)}</strong></div>` : ""}
        ${viewMode === "cancelled" || viewMode === "returns" ? "" : `<div><span>Delivery</span><strong>${escapeHtml(order.deliveryStatus || order.status || "—")}</strong></div>`}
        <div><span>Grand Total</span><strong>${formatCurrency(order.total || 0)}</strong></div>
      </div>
      ${renderActions(order, viewMode)}
      ${viewMode === "pending" || viewMode === "completed" || viewMode === "cancelled" || viewMode === "returns" ? "" : renderStatusSelect(order)}
      <div class="orders-order-details" ${expanded ? "" : "hidden"}>
        ${renderCustomerBlock(order)}
        ${renderOrderInfoBlock(order, viewMode)}
        ${viewMode === "returns" ? renderReturnInfoBlock(order) : ""}
        ${viewMode === "completed" ? renderDeliveryBlock(order) : ""}
        ${viewMode === "cancelled" ? `
          <div class="orders-detail-card">
            <h4>Cancellation Details</h4>
            ${renderInfoGrid([
              ["Cancellation Date", cancellationDate ? formatDate(cancellationDate) : "—"],
              ["Cancelled By", resolveCancelledBy(order)],
              ["Cancellation Reason", resolveCancellationReason(order) || "—"],
              ["Refund Required", order.refundRequired ? "Yes — prepared for Returns & Refunds" : "No"]
            ])}
          </div>
        ` : ""}
        <div class="orders-detail-card">
          <h4>Payment Details</h4>
          ${renderInfoGrid([
            ["Method", paymentLabel(order)],
            ["Status", paymentStatus],
            ["Type", order.paymentType || (order.paymentMethod === "cod" ? "cod" : "pay_now")],
            ["Payer Phone", order.payerPhone || order.customerPhone],
            ["Note", order.paymentNote]
          ])}
          ${renderGps(order)}
        </div>
        ${renderTimeline(order, viewMode)}
        <div class="orders-detail-card">
          <h4>Purchased Products</h4>
          ${items.length
            ? `<div class="orders-products-list">${items.map(renderProductCard).join("")}</div>`
            : `<p class="orders-empty-state">No products on this order.</p>`}
        </div>
        ${viewMode === "pending" ? renderStatusSelect(order) : ""}
      </div>
    </article>
  `;
}

function buildPrintRows(order) {
  const ship = order.shippingAddress || {};
  const full = order.fullAddress || {};
  return [
    ["Order", order.orderId || order.id],
    ["Date", formatDate(order.date)],
    ["Status", order.status],
    ["Customer", ship.fullName || order.customerName],
    ["Phone", ship.phone || order.customerPhone],
    ["Email", order.customerEmail || "—"],
    ["Address", [
      ship.provinceCity || full.province,
      ship.district || full.district,
      ship.sector || full.sector,
      ship.cell || full.cell,
      ship.village || full.village,
      ship.note || full.note
    ].filter(Boolean).join(", ")],
    ["Payment", `${paymentLabel(order)} · ${order.paymentStatusLabel || order.paymentStatus || "Pending"}`],
    ["Subtotal", formatCurrency(order.subtotal || 0)],
    ["Shipping", formatCurrency(order.deliveryFee || 0)],
    ["Total", formatCurrency(order.total || 0)]
  ];
}

function printInvoice(order) {
  const rows = buildPrintRows(order);
  const items = Array.isArray(order.items) ? order.items : [];
  openPrintableReport(`Invoice ${order.orderId || order.id}`, [
    {
      title: "Order Summary",
      content: `<table><tbody>${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}</tbody></table>`
    },
    {
      title: "Products",
      content: `<table><thead><tr><th>Product</th><th>SKU</th><th>Variant</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead><tbody>${
        items.map((item) => `<tr>
          <td>${escapeHtml(item.productName)}</td>
          <td>${escapeHtml(item.sku || "—")}</td>
          <td>${escapeHtml(item.attributeSummary || [item.color, item.size].filter(Boolean).join(" · ") || "—")}</td>
          <td>${escapeHtml(item.quantity || 1)}</td>
          <td>${formatCurrency(item.price || 0)}</td>
          <td>${formatCurrency(item.lineTotal || ((Number(item.price) || 0) * (Number(item.quantity) || 1)))}</td>
        </tr>`).join("")
      }</tbody></table>`
    }
  ]);
}

function printPackingSlip(order) {
  const ship = order.shippingAddress || {};
  const items = Array.isArray(order.items) ? order.items : [];
  openPrintableReport(`Packing Slip ${order.orderId || order.id}`, [
    {
      title: "Ship To",
      content: `<p><strong>${escapeHtml(ship.fullName || order.customerName)}</strong><br>${escapeHtml(ship.phone || order.customerPhone || "")}<br>${escapeHtml([
        ship.provinceCity,
        ship.district,
        ship.sector,
        ship.cell,
        ship.village,
        ship.note
      ].filter(Boolean).join(", "))}</p>`
    },
    {
      title: "Pack Contents",
      content: `<table><thead><tr><th>Product</th><th>SKU</th><th>Color</th><th>Size</th><th>Qty</th></tr></thead><tbody>${
        items.map((item) => `<tr>
          <td>${escapeHtml(item.productName)}</td>
          <td>${escapeHtml(item.sku || "—")}</td>
          <td>${escapeHtml(item.color || "—")}</td>
          <td>${escapeHtml(item.size || "—")}</td>
          <td>${escapeHtml(item.quantity || 1)}</td>
        </tr>`).join("")
      }</tbody></table>`
    }
  ]);
}

function printReceipt(order) {
  const rows = buildPrintRows(order);
  const completionDate = resolveCompletionDate(order);
  openPrintableReport(`Receipt ${order.orderId || order.id}`, [
    {
      title: "Payment Receipt",
      subtitle: completionDate ? `Completed ${formatDate(completionDate)}` : "Completed order receipt",
      content: `<table><tbody>${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}</tbody></table>
        <p><strong>Amount paid / due:</strong> ${formatCurrency(order.total || 0)}</p>
        <p><strong>Payment:</strong> ${escapeHtml(paymentLabel(order))} · ${escapeHtml(order.paymentStatusLabel || order.paymentStatus || "Pending")}</p>`
    }
  ]);
}

function downloadInvoicePdf(order) {
  // Opens the printable invoice so the browser can Save as PDF — no extra PDF dependency.
  printInvoice(order);
}

function showCustomerDetails(order) {
  const ship = order.shippingAddress || {};
  const lines = [
    `Customer: ${ship.fullName || order.customerName || "—"}`,
    `Phone: ${ship.phone || order.customerPhone || "—"}`,
    `Email: ${order.customerEmail || "—"}`,
    `Province/City: ${ship.provinceCity || order.fullAddress?.province || "—"}`,
    `District: ${ship.district || order.fullAddress?.district || "—"}`,
    `Sector: ${ship.sector || order.fullAddress?.sector || "—"}`,
    `Cell: ${ship.cell || order.fullAddress?.cell || "—"}`,
    `Village: ${ship.village || order.fullAddress?.village || "—"}`,
    `Landmark: ${ship.note || order.fullAddress?.note || "—"}`
  ];
  window.alert(lines.join("\n"));
}

function showDeliveryDetails(order) {
  const ship = order.shippingAddress || {};
  const completionDate = resolveCompletionDate(order);
  const lines = [
    `Order: ${order.orderId || order.id}`,
    `Delivery status: ${order.deliveryStatus || order.status || "—"}`,
    `Shipping method: ${order.deliveryLabel || order.deliveryMethod || "Home delivery"}`,
    `Completed: ${completionDate ? formatDate(completionDate) : "—"}`,
    `Address: ${[
      ship.provinceCity,
      ship.district,
      ship.sector,
      ship.cell,
      ship.village,
      ship.note
    ].filter(Boolean).join(", ") || "—"}`,
    `Maps: ${resolveMapLink(order) || "—"}`
  ];
  window.alert(lines.join("\n"));
}

function showCancellationReason(order) {
  const lines = [
    `Order: ${order.orderId || order.id}`,
    `Cancelled by: ${resolveCancelledBy(order)}`,
    `Cancellation date: ${resolveCancellationDate(order) ? formatDate(resolveCancellationDate(order)) : "—"}`,
    `Reason: ${resolveCancellationReason(order) || "No reason recorded."}`,
    `Refund required: ${order.refundRequired ? "Yes" : "No"}`
  ];
  window.alert(lines.join("\n"));
}

function printOrderSummary(order) {
  const rows = buildPrintRows(order);
  const cancellationDate = resolveCancellationDate(order);
  openPrintableReport(`Order Summary ${order.orderId || order.id}`, [
    {
      title: "Cancelled Order Summary",
      subtitle: cancellationDate ? `Cancelled ${formatDate(cancellationDate)}` : "Cancelled order record",
      content: `<table><tbody>
        ${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}
        <tr><th>Cancelled By</th><td>${escapeHtml(resolveCancelledBy(order))}</td></tr>
        <tr><th>Cancellation Reason</th><td>${escapeHtml(resolveCancellationReason(order) || "—")}</td></tr>
        <tr><th>Refund Required</th><td>${order.refundRequired ? "Yes" : "No"}</td></tr>
      </tbody></table>`
    },
    {
      title: "Products",
      content: `<table><thead><tr><th>Product</th><th>SKU</th><th>Qty</th><th>Total</th></tr></thead><tbody>${
        (order.items || []).map((item) => `<tr>
          <td>${escapeHtml(item.productName)}</td>
          <td>${escapeHtml(item.sku || "—")}</td>
          <td>${escapeHtml(item.quantity || 1)}</td>
          <td>${formatCurrency(item.lineTotal || ((Number(item.price) || 0) * (Number(item.quantity) || 1)))}</td>
        </tr>`).join("")
      }</tbody></table>`
    }
  ]);
}

function printReturnReport(order) {
  const workflow = getReturnWorkflow(order);
  const rows = buildPrintRows(order);
  openPrintableReport(`Return Report ${order.orderId || order.id}`, [
    {
      title: "Return Report",
      subtitle: resolveReturnRequestDate(order) ? `Requested ${formatDate(resolveReturnRequestDate(order))}` : "Return record",
      content: `<table><tbody>
        ${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}
        <tr><th>Return Reason</th><td>${escapeHtml(workflow.returnReason || resolveCancellationReason(order) || "—")}</td></tr>
        <tr><th>Customer Notes</th><td>${escapeHtml(workflow.customerNotes || "—")}</td></tr>
        <tr><th>Admin Notes</th><td>${escapeHtml(workflow.adminNotes || "—")}</td></tr>
        <tr><th>Product Condition</th><td>${escapeHtml(workflow.productCondition || "—")}</td></tr>
        <tr><th>Return Status</th><td>${escapeHtml(formatReturnStatusLabel(workflow.returnStatus))}</td></tr>
        <tr><th>Refund Status</th><td>${escapeHtml(formatRefundStatusLabel(workflow.refundStatus || (order.refundRequired ? "required" : "")))}</td></tr>
      </tbody></table>`
    },
    {
      title: "Products",
      content: `<table><thead><tr><th>Product</th><th>SKU</th><th>Variant</th><th>Qty</th><th>Total</th></tr></thead><tbody>${
        (order.items || []).map((item) => `<tr>
          <td>${escapeHtml(item.productName)}</td>
          <td>${escapeHtml(item.sku || "—")}</td>
          <td>${escapeHtml(item.attributeSummary || [item.color, item.size].filter(Boolean).join(" · ") || "—")}</td>
          <td>${escapeHtml(item.quantity || 1)}</td>
          <td>${formatCurrency(item.lineTotal || ((Number(item.price) || 0) * (Number(item.quantity) || 1)))}</td>
        </tr>`).join("")
      }</tbody></table>`
    }
  ]);
}

function printRefundReport(order) {
  const workflow = getReturnWorkflow(order);
  const rows = buildPrintRows(order);
  const amount = Number(workflow.refundAmount || order.refundAmount || order.total || 0);
  openPrintableReport(`Refund Report ${order.orderId || order.id}`, [
    {
      title: "Refund Report",
      subtitle: resolveRefundDate(order) ? `Refunded ${formatDate(resolveRefundDate(order))}` : "Refund record",
      content: `<table><tbody>
        ${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}
        <tr><th>Refund Status</th><td>${escapeHtml(formatRefundStatusLabel(workflow.refundStatus || order.paymentStatus))}</td></tr>
        <tr><th>Refund Amount</th><td>${escapeHtml(formatCurrency(amount))}</td></tr>
        <tr><th>Refund Method</th><td>${escapeHtml(workflow.refundMethod || paymentLabel(order))}</td></tr>
        <tr><th>Refund Date</th><td>${escapeHtml(resolveRefundDate(order) ? formatDate(resolveRefundDate(order)) : "—")}</td></tr>
        <tr><th>Admin Notes</th><td>${escapeHtml(workflow.adminNotes || "—")}</td></tr>
      </tbody></table>`
    }
  ]);
}

function showPaymentAlert(order) {
  const lines = [
    `Order: ${order.orderId || order.id}`,
    `Method: ${paymentLabel(order)}`,
    `Status: ${order.paymentStatusLabel || order.paymentStatus || "Pending"}`,
    `Type: ${order.paymentType || "—"}`,
    `Payer phone: ${order.payerPhone || order.customerPhone || "—"}`,
    `Note: ${order.paymentNote || "—"}`,
    `Grand total: ${formatCurrency(order.total || 0)}`
  ];
  window.alert(lines.join("\n"));
}

let unsubscribeLive = null;
let ordersPageApi = null;

export async function renderOrders(container, options = {}) {
  // Soft refresh: reload data in place without wiping search/filters/expanded state.
  if (options?.softRefresh && ordersPageApi?.reload && container?.dataset?.ordersMounted === "1") {
    await ordersPageApi.reload({ force: true });
    return;
  }

  if (typeof unsubscribeLive === "function") {
    unsubscribeLive();
    unsubscribeLive = null;
  }
  ordersPageApi = null;

  const hashQuery = readHashQuery();
  const state = {
    query: "",
    statusFilter: hashQuery.get("status") || "",
    paymentFilter: "",
    sort: hashQuery.get("status") === "completed"
      ? "completed-desc"
      : hashQuery.get("status") === "cancelled"
        ? "cancelled-desc"
        : hashQuery.get("status") === "returns"
          ? "return-desc"
          : "date-desc",
    cancelledByFilter: "",
    returnStatusFilter: "",
    refundStatusFilter: "",
    page: 1,
    expandedId: "",
    allOrders: [],
    loading: false,
    notice: null,
    busyOrderId: ""
  };

  function findOrder(orderId) {
    return state.allOrders.find((order) => String(order.orderId || order.id) === String(orderId));
  }

  function setNotice(message, tone = "success") {
    state.notice = message ? { message, tone } : null;
  }

  function renderNotice() {
    if (!state.notice?.message) return "";
    return `<div class="orders-status-message orders-status-message--${escapeHtml(state.notice.tone || "neutral")}" role="status">${escapeHtml(state.notice.message)}</div>`;
  }

  function renderToolbar(filteredCount, totalCount) {
    const meta = getOrdersViewMeta(state.statusFilter);
    const lockFilter = meta.mode !== "all";
    return `
      <section class="orders-toolbar-panel glass-panel">
        <div class="orders-toolbar-copy">
          <p class="dashboard-eyebrow">${escapeHtml(meta.eyebrow)}</p>
          <h2>${escapeHtml(meta.title)}</h2>
          <p>${escapeHtml(meta.description)}</p>
        </div>
        ${renderNotice()}
        <div class="orders-toolbar-actions">
          <label class="orders-search-field">
            <span aria-hidden="true">⌕</span>
            <input type="search" id="ordersSearch" placeholder="Search order, customer, phone, product, SKU" value="${escapeHtml(state.query)}" ${state.loading ? "disabled" : ""} />
          </label>
          <select id="ordersStatusFilter" class="input" aria-label="Filter by status" ${lockFilter ? "disabled" : ""}>
            <option value="" ${!state.statusFilter ? "selected" : ""}>All statuses</option>
            <option value="pending" ${state.statusFilter === "pending" ? "selected" : ""}>Pending queue</option>
            <option value="completed" ${state.statusFilter === "completed" ? "selected" : ""}>Completed</option>
            <option value="cancelled" ${state.statusFilter === "cancelled" ? "selected" : ""}>Cancelled</option>
            <option value="returns" ${state.statusFilter === "returns" ? "selected" : ""}>Returns &amp; refunds</option>
            ${STATUS_OPTIONS.map((status) => {
              const value = `status:${status.toLowerCase()}`;
              return `<option value="${escapeHtml(value)}" ${state.statusFilter === value ? "selected" : ""}>${escapeHtml(status)} only</option>`;
            }).join("")}
          </select>
          <select id="ordersSort" class="input" aria-label="Sort orders" ${state.loading ? "disabled" : ""}>
            <option value="date-desc" ${state.sort === "date-desc" ? "selected" : ""}>Newest first</option>
            <option value="date-asc" ${state.sort === "date-asc" ? "selected" : ""}>Oldest first</option>
            ${meta.mode === "completed" ? `
              <option value="completed-desc" ${state.sort === "completed-desc" ? "selected" : ""}>Newest completion</option>
              <option value="completed-asc" ${state.sort === "completed-asc" ? "selected" : ""}>Oldest completion</option>
            ` : ""}
            ${meta.mode === "cancelled" ? `
              <option value="cancelled-desc" ${state.sort === "cancelled-desc" ? "selected" : ""}>Newest cancellation</option>
              <option value="cancelled-asc" ${state.sort === "cancelled-asc" ? "selected" : ""}>Oldest cancellation</option>
            ` : ""}
            ${meta.mode === "returns" ? `
              <option value="return-desc" ${state.sort === "return-desc" ? "selected" : ""}>Newest return request</option>
              <option value="return-asc" ${state.sort === "return-asc" ? "selected" : ""}>Oldest return request</option>
            ` : ""}
            <option value="total-desc" ${state.sort === "total-desc" ? "selected" : ""}>Highest total</option>
            <option value="total-asc" ${state.sort === "total-asc" ? "selected" : ""}>Lowest total</option>
            <option value="status" ${state.sort === "status" ? "selected" : ""}>Status</option>
          </select>
          ${meta.mode === "completed" || meta.mode === "cancelled" || meta.mode === "returns" ? `
            <select id="ordersPaymentFilter" class="input" aria-label="Filter by payment method" ${state.loading ? "disabled" : ""}>
              <option value="" ${!state.paymentFilter ? "selected" : ""}>All payment methods</option>
              <option value="mtn" ${state.paymentFilter === "mtn" ? "selected" : ""}>MTN</option>
              <option value="airtel" ${state.paymentFilter === "airtel" ? "selected" : ""}>Airtel</option>
              <option value="cod" ${state.paymentFilter === "cod" ? "selected" : ""}>Cash on Delivery</option>
              <option value="bank" ${state.paymentFilter === "bank" ? "selected" : ""}>Bank</option>
              <option value="card" ${state.paymentFilter === "card" ? "selected" : ""}>Card</option>
            </select>
          ` : ""}
          ${meta.mode === "returns" ? `
            <select id="ordersReturnStatusFilter" class="input" aria-label="Filter by return status" ${state.loading ? "disabled" : ""}>
              <option value="" ${!state.returnStatusFilter ? "selected" : ""}>All return statuses</option>
              <option value="requested" ${state.returnStatusFilter === "requested" ? "selected" : ""}>Requested</option>
              <option value="approved" ${state.returnStatusFilter === "approved" ? "selected" : ""}>Approved</option>
              <option value="rejected" ${state.returnStatusFilter === "rejected" ? "selected" : ""}>Rejected</option>
            </select>
            <select id="ordersRefundStatusFilter" class="input" aria-label="Filter by refund status" ${state.loading ? "disabled" : ""}>
              <option value="" ${!state.refundStatusFilter ? "selected" : ""}>All refund statuses</option>
              <option value="required" ${state.refundStatusFilter === "required" ? "selected" : ""}>Required</option>
              <option value="completed" ${state.refundStatusFilter === "completed" ? "selected" : ""}>Completed</option>
              <option value="rejected" ${state.refundStatusFilter === "rejected" ? "selected" : ""}>Rejected</option>
            </select>
          ` : ""}
          ${meta.mode === "cancelled" ? `
            <select id="ordersCancelledByFilter" class="input" aria-label="Filter by cancelled by" ${state.loading ? "disabled" : ""}>
              <option value="" ${!state.cancelledByFilter ? "selected" : ""}>Cancelled by anyone</option>
              <option value="admin" ${state.cancelledByFilter === "admin" ? "selected" : ""}>Admin</option>
              <option value="customer" ${state.cancelledByFilter === "customer" ? "selected" : ""}>Customer</option>
            </select>
          ` : ""}
          <button type="button" class="btn btn-primary" id="ordersRefreshBtn" ${state.loading ? "disabled" : ""}>${state.loading ? "Refreshing..." : "Refresh"}</button>
        </div>
        <div class="orders-hero-status-row">
          <span>${state.loading ? "Loading orders..." : `${filteredCount} shown · ${totalCount} loaded`}</span>
          ${meta.mode === "pending" || meta.mode === "completed" || meta.mode === "cancelled" || meta.mode === "returns" ? `<a class="orders-inline-link" href="#/orders">Open All Orders</a>` : ""}
        </div>
      </section>
    `;
  }

  function renderPagination(totalPages) {
    if (totalPages <= 1) return "";
    return `
      <div class="orders-pagination">
        <button type="button" class="orders-secondary-link" data-page-action="prev" ${state.page <= 1 || state.loading ? "disabled" : ""}>Previous</button>
        <span>Page ${state.page} of ${totalPages}</span>
        <button type="button" class="orders-secondary-link" data-page-action="next" ${state.page >= totalPages || state.loading ? "disabled" : ""}>Next</button>
      </div>
    `;
  }

  function paintFromState() {
    const meta = getOrdersViewMeta(state.statusFilter);
    const filtered = filterAndSortOrders(state.allOrders, state);
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    const start = (state.page - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);

    if (state.loading && !state.allOrders.length) {
      container.innerHTML = panel(meta.title, meta.description, `<div class="state-block">Loading ${escapeHtml(meta.title.toLowerCase())}...</div>`);
      return;
    }

    if (!state.loading && !state.allOrders.length) {
      container.innerHTML = panel(meta.title, meta.description, emptyState("No orders found."));
      return;
    }

    const emptyCopy = meta.mode === "pending"
      ? "No pending orders right now. New checkout orders will appear here automatically."
      : meta.mode === "completed"
        ? "No completed orders yet. Orders marked Delivered or Completed will appear here automatically."
        : meta.mode === "cancelled"
          ? "No cancelled orders yet. Customer or admin cancellations will appear here automatically."
          : meta.mode === "returns"
            ? "No return or refund requests yet. Paid cancellations and return requests will appear here automatically."
            : "No orders match your search or filters.";

    const cards = pageItems.length
      ? pageItems.map((order) => renderOrderCard(order, {
        expanded: String(order.orderId || order.id) === String(state.expandedId),
        viewMode: meta.mode
      })).join("")
      : `<div class="orders-empty-state">${emptyState(emptyCopy)}</div>`;

    container.innerHTML = `
      <div class="orders-page-grid">
        ${renderToolbar(filtered.length, state.allOrders.length)}
        <div class="orders-mobile-grid">${cards}</div>
        ${renderPagination(totalPages)}
      </div>
    `;
  }

  async function loadOrders(options = {}) {
    const query = typeof options === "boolean" ? { force: options } : (options || {});
    state.loading = true;
    paintFromState();
    try {
      state.allOrders = await getOrders({ ...query, force: query.force !== false });
      if (query.resetFilter || readHashQuery().has("status")) {
        state.statusFilter = readHashQuery().get("status") || (query.resetFilter ? "" : state.statusFilter);
        if (query.resetFilter) state.page = 1;
      }
    } catch (error) {
      console.error(error);
      setNotice(error?.message || "Unable to load orders.", "danger");
    } finally {
      state.loading = false;
      paintFromState();
    }
  }

  async function applyStatusChange(orderId, nextStatus, successMessage, options = {}) {
    if (!orderId || !nextStatus || state.busyOrderId) return;
    state.busyOrderId = String(orderId);
    setNotice(`Updating order ${orderId}...`, "warn");
    paintFromState();
    try {
      await updateOrderStatus(orderId, nextStatus, options);
      setNotice(successMessage || `Order ${orderId} updated to ${nextStatus}.`, "success");
      state.expandedId = "";
      await loadOrders({ force: true });
    } catch (error) {
      console.error(error);
      setNotice(error?.message || "Unable to update order status.", "danger");
      paintFromState();
    } finally {
      state.busyOrderId = "";
    }
  }

  async function applyReturnAction(orderId, returnAction, successMessage, options = {}) {
    if (!orderId || !returnAction || state.busyOrderId) return;
    state.busyOrderId = String(orderId);
    setNotice(`Processing ${returnAction.replace(/_/g, " ")} for ${orderId}...`, "warn");
    paintFromState();
    try {
      await updateOrderStatus(orderId, "", { ...options, returnAction });
      setNotice(successMessage || `Return action completed for ${orderId}.`, "success");
      state.expandedId = String(orderId);
      await loadOrders({ force: true });
    } catch (error) {
      console.error(error);
      setNotice(error?.message || "Unable to process return/refund action.", "danger");
      paintFromState();
    } finally {
      state.busyOrderId = "";
    }
  }

  await loadOrders({ force: true, resetFilter: true });

  container.oninput = (event) => {
    if (event.target?.id === "ordersSearch") {
      state.query = event.target.value;
      state.page = 1;
      paintFromState();
    }
  };

  container.onchange = async (event) => {
    const target = event.target;
    if (!target) return;

    if (target.id === "ordersStatusFilter") {
      const nextValue = target.value;
      const nextHash = nextValue
        ? `#/orders?status=${encodeURIComponent(nextValue)}`
        : "#/orders";
      const currentHash = String(window.location.hash || "").split("&")[0];
      // Keep toolbar filter synchronized with hash so live reloads preserve the queue.
      if (currentHash.toLowerCase() !== nextHash.toLowerCase()) {
        window.location.hash = nextHash;
        return;
      }
      state.statusFilter = nextValue;
      state.page = 1;
      paintFromState();
      return;
    }

    if (target.id === "ordersSort") {
      state.sort = target.value;
      state.page = 1;
      paintFromState();
      return;
    }

    if (target.id === "ordersPaymentFilter") {
      state.paymentFilter = target.value;
      state.page = 1;
      paintFromState();
      return;
    }

    if (target.id === "ordersCancelledByFilter") {
      state.cancelledByFilter = target.value;
      state.page = 1;
      paintFromState();
      return;
    }

    if (target.id === "ordersReturnStatusFilter") {
      state.returnStatusFilter = target.value;
      state.page = 1;
      paintFromState();
      return;
    }

    if (target.id === "ordersRefundStatusFilter") {
      state.refundStatusFilter = target.value;
      state.page = 1;
      paintFromState();
      return;
    }

    const select = target.closest?.("select[data-order-status]");
    if (!select) return;
    const orderId = select.getAttribute("data-order-status");
    const nextStatus = select.value;
    select.disabled = true;
    await applyStatusChange(orderId, nextStatus, `Order ${orderId} status set to ${nextStatus}.`);
  };

  container.onclick = (event) => {
    const refreshBtn = event.target?.closest?.("#ordersRefreshBtn");
    if (refreshBtn) {
      setNotice("");
      void loadOrders({ force: true });
      return;
    }

    const pageBtn = event.target?.closest?.("[data-page-action]");
    if (pageBtn) {
      const action = pageBtn.getAttribute("data-page-action");
      if (action === "prev" && state.page > 1) state.page -= 1;
      if (action === "next") state.page += 1;
      paintFromState();
      return;
    }

    const actionBtn = event.target?.closest?.("[data-order-action]");
    if (!actionBtn) return;
    const orderId = actionBtn.getAttribute("data-order-id");
    const action = actionBtn.getAttribute("data-order-action");
    const order = findOrder(orderId);
    if (!order) return;

    if (action === "toggle") {
      state.expandedId = String(state.expandedId) === String(orderId) ? "" : String(orderId);
      paintFromState();
      return;
    }
    if (action === "invoice") {
      printInvoice(order);
      setNotice(`Invoice opened for ${orderId}.`, "success");
      paintFromState();
      return;
    }
    if (action === "receipt") {
      printReceipt(order);
      setNotice(`Receipt opened for ${orderId}.`, "success");
      paintFromState();
      return;
    }
    if (action === "download-invoice") {
      downloadInvoicePdf(order);
      setNotice(`Use your browser Print dialog to save invoice ${orderId} as PDF.`, "success");
      paintFromState();
      return;
    }
    if (action === "packing") {
      printPackingSlip(order);
      return;
    }
    if (action === "payment") {
      showPaymentAlert(order);
      return;
    }
    if (action === "customer") {
      showCustomerDetails(order);
      return;
    }
    if (action === "delivery") {
      showDeliveryDetails(order);
      return;
    }
    if (action === "cancellation-reason") {
      showCancellationReason(order);
      return;
    }
    if (action === "summary") {
      printOrderSummary(order);
      setNotice(`Order summary opened for ${orderId}.`, "success");
      paintFromState();
      return;
    }
    if (action === "print-return") {
      printReturnReport(order);
      setNotice(`Return report opened for ${orderId}.`, "success");
      paintFromState();
      return;
    }
    if (action === "print-refund") {
      printRefundReport(order);
      setNotice(`Refund report opened for ${orderId}.`, "success");
      paintFromState();
      return;
    }
    if (action === "view-original") {
      state.expandedId = String(orderId);
      window.location.hash = "#/orders";
      return;
    }
    if (action === "open-return") {
      const reason = window.prompt(`Open return request for ${orderId}?\n\nReturn reason:`, getReturnWorkflow(order).returnReason || "Customer return request") || "";
      if (!reason.trim()) return;
      const confirmed = window.confirm(`Confirm opening a return request for order ${orderId}?`);
      if (!confirmed) return;
      void applyReturnAction(orderId, "open_return", `Return request opened for ${orderId}.`, {
        reason: reason.trim(),
        adminNotes: reason.trim()
      });
      return;
    }
    if (action === "approve-return") {
      const note = window.prompt(`Approve return for ${orderId}?\n\nOptional admin notes:`, getReturnWorkflow(order).adminNotes || "Return approved") || "";
      const confirmed = window.confirm(`Approve return for order ${orderId}?\n\nStock will be restored when appropriate.`);
      if (!confirmed) return;
      void applyReturnAction(orderId, "approve_return", `Return approved for ${orderId}.`, {
        adminNotes: note.trim() || "Return approved"
      });
      return;
    }
    if (action === "reject-return") {
      const note = window.prompt(`Reject return for ${orderId}?\n\nRejection reason:`, "Return rejected") || "";
      if (!note.trim()) return;
      const confirmed = window.confirm(`Reject return for order ${orderId}?`);
      if (!confirmed) return;
      void applyReturnAction(orderId, "reject_return", `Return rejected for ${orderId}.`, {
        adminNotes: note.trim()
      });
      return;
    }
    if (action === "approve-refund") {
      const defaultAmount = String(getReturnWorkflow(order).refundAmount || order.total || 0);
      const amountRaw = window.prompt(`Approve refund for ${orderId}?\n\nRefund amount:`, defaultAmount);
      if (amountRaw == null) return;
      const amount = Number(amountRaw);
      if (!Number.isFinite(amount) || amount < 0) {
        setNotice("Enter a valid refund amount.", "danger");
        paintFromState();
        return;
      }
      const method = window.prompt("Refund method:", getReturnWorkflow(order).refundMethod || paymentLabel(order) || "original_payment") || "original_payment";
      const note = window.prompt("Optional admin notes:", getReturnWorkflow(order).adminNotes || "Refund approved") || "Refund approved";
      const confirmed = window.confirm(`Confirm refund of ${formatCurrency(amount)} for order ${orderId}?\n\nThis updates payment records, reports, and dashboard statistics. Duplicate refunds are blocked.`);
      if (!confirmed) return;
      void applyReturnAction(orderId, "approve_refund", `Refund approved for ${orderId}.`, {
        refundAmount: amount,
        refundMethod: method.trim(),
        adminNotes: note.trim() || "Refund approved"
      });
      return;
    }
    if (action === "reject-refund") {
      const note = window.prompt(`Reject refund for ${orderId}?\n\nRejection reason:`, "Refund rejected") || "";
      if (!note.trim()) return;
      const confirmed = window.confirm(`Reject refund for order ${orderId}?`);
      if (!confirmed) return;
      void applyReturnAction(orderId, "reject_refund", `Refund rejected for ${orderId}.`, {
        adminNotes: note.trim()
      });
      return;
    }
    if (action === "restore") {
      const confirmed = window.confirm(`Restore order ${orderId} back to Pending?\n\nStock will be re-reserved if available. Confirm inventory before fulfilling.`);
      if (!confirmed) return;
      void applyStatusChange(orderId, "Pending", `Order ${orderId} restored to Pending.`, {
        reason: "Order restored by administrator"
      });
      return;
    }
    if (action === "accept") {
      void applyStatusChange(orderId, "Confirmed", `Order ${orderId} accepted and moved out of Pending Orders.`);
      return;
    }
    if (action === "process") {
      void applyStatusChange(orderId, "Processing", `Order ${orderId} is now processing.`);
      return;
    }
    if (action === "cancel") {
      const reason = window.prompt(`Cancel order ${orderId}?\n\nOptional cancellation reason:`, "Cancelled by administrator") || "";
      const confirmed = window.confirm(`Confirm cancellation of order ${orderId}?\n\nStock will be restored. Paid orders are prepared for Returns & Refunds.`);
      if (!confirmed) return;
      void applyStatusChange(orderId, "Cancelled", `Order ${orderId} cancelled.`, {
        reason: reason.trim() || "Cancelled by administrator"
      });
    }
  };

  unsubscribeLive = subscribeToLiveFeeds("orders", () => {
    void loadOrders({ preferCache: false, force: true });
  });

  container.dataset.ordersMounted = "1";
  ordersPageApi = {
    reload: (opts = {}) => loadOrders({ force: true, ...opts })
  };
}
