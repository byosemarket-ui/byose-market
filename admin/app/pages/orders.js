import { badge, emptyState, formatCurrency, formatDate, panel } from "../components/ui.js";
import { getOrders, updateOrderStatus } from "../services/admin-data.service.js";
import { subscribeToLiveFeeds } from "../services/live-feeds.service.js";

const STATUS_OPTIONS = ["Pending", "Confirmed", "Processing", "Shipping", "Delivered", "Cancelled", "Returned"];

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusTone(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("deliver") || value.includes("complete")) return "success";
  if (value.includes("cancel") || value.includes("return")) return "danger";
  if (value.includes("ship") || value.includes("confirm")) return "warn";
  return "neutral";
}

function paymentLabel(order) {
  if (order?.paymentMethod === "cod" || String(order?.paymentMethodLabel || "").toLowerCase().includes("cash")) {
    return "Cash on Delivery";
  }
  return order?.paymentMethodLabel || order?.paymentMethod || "—";
}

function formatAddress(order) {
  const ship = order?.shippingAddress || {};
  const full = order?.fullAddress || {};
  return [
    ship.fullName || order.customerName,
    ship.phone || order.customerPhone,
    ship.provinceCity || full.province,
    ship.district || full.district,
    ship.sector || full.sector,
    ship.cell || full.cell,
    ship.village || full.village,
    ship.note || full.note
  ].filter(Boolean).map(escapeHtml).join("<br>");
}

function renderGps(order) {
  const gps = order?.gpsLocation || {};
  const lat = gps.latitude;
  const lng = gps.longitude;
  if (!lat || !lng) return "";
  const mapLink = gps.googleMapsLink || gps.mapLink || `https://www.google.com/maps?q=${lat},${lng}`;
  return `<p class="orders-inline-link-wrap"><a class="orders-inline-link" href="${escapeHtml(mapLink)}" target="_blank" rel="noopener">Open GPS on Maps</a> <small>(${escapeHtml(lat)}, ${escapeHtml(lng)})</small></p>`;
}

function renderProductCard(item) {
  const rawImage = item?.image || item?.colorImage || "";
  const imageSrc = (() => {
    const value = String(rawImage || "").trim();
    if (!value) return "";
    if (/^(?:https?:|data:|blob:)/i.test(value)) return value;
    if (value.startsWith("/uploads/") || value.startsWith("/img/")) return value;
    if (value.startsWith("uploads/") || value.startsWith("img/")) return `/${value}`;
    if (/^(?:products|categories|users|reviews|hero|temp)\//i.test(value)) return `/uploads/${value}`;
    if (value.startsWith("/")) return value;
    return value;
  })();
  const image = imageSrc ? `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(item.productName)}" loading="lazy">` : `<div class="order-product-ph">📦</div>`;
  const meta = [item?.color, item?.size, item?.sku ? `SKU ${item.sku}` : "", item?.category].filter(Boolean).join(" · ");
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
            ${meta ? `<p>${escapeHtml(meta)}</p>` : ""}
          </div>
          <strong>${formatCurrency((Number(item?.price) || 0) * (Number(item?.quantity) || 1))}</strong>
        </div>
        <div class="order-product-meta">
          <div><span>Qty</span><strong>${escapeHtml(item?.quantity || 1)}</strong></div>
          <div><span>Unit price</span><strong>${formatCurrency(item?.price || 0)}</strong></div>
        </div>
        ${link}
      </div>
    </article>
  `;
}

function renderStatusSelect(order) {
  const current = String(order.status || order.orderStatus || "Pending");
  const options = STATUS_OPTIONS.map((status) => (
    `<option value="${escapeHtml(status)}" ${status.toLowerCase() === current.toLowerCase() ? "selected" : ""}>${escapeHtml(status)}</option>`
  )).join("");

  return `
    <label class="orders-status-control">
      <span>Update status</span>
      <select data-order-status="${escapeHtml(order.orderId || order.id)}">${options}</select>
    </label>
  `;
}

function renderOrderCard(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const paymentStatus = order?.paymentStatusLabel || order?.paymentStatus || "Pending";

  return `
    <article class="order-mobile-card" data-order-id="${escapeHtml(order.orderId || order.id)}">
      <div class="order-mobile-head">
        <div>
          <h3>${escapeHtml(order.orderId || order.id)}</h3>
          <p>${formatDate(order.date)}</p>
        </div>
        ${badge(String(order.status || "Pending"), statusTone(order.status))}
      </div>
      <div class="order-mobile-meta">
        <div><span>Customer</span><strong>${escapeHtml(order.customerName)}</strong></div>
        <div><span>Phone</span><strong>${escapeHtml(order.customerPhone || "—")}</strong></div>
        <div><span>Payment</span><strong>${escapeHtml(paymentLabel(order))}</strong></div>
        <div><span>Payment status</span><strong>${escapeHtml(paymentStatus)}</strong></div>
        <div><span>Subtotal</span><strong>${formatCurrency(order.subtotal || 0)}</strong></div>
        <div><span>Delivery</span><strong>${formatCurrency(order.deliveryFee || 0)}</strong></div>
        ${Number(order.codFee) > 0 ? `<div><span>COD fee</span><strong>${formatCurrency(order.codFee)}</strong></div>` : ""}
        <div><span>Total</span><strong>${formatCurrency(order.total || 0)}</strong></div>
      </div>
      <div class="orders-detail-card">
        <h4>Shipping</h4>
        <div class="orders-address-block"><p>${formatAddress(order)}</p>${renderGps(order)}</div>
        ${renderStatusSelect(order)}
      </div>
      ${items.length ? `<div class="orders-products-list">${items.map(renderProductCard).join("")}</div>` : ""}
    </article>
  `;
}

let unsubscribeLive = null;

export async function renderOrders(container) {
  if (typeof unsubscribeLive === "function") {
    unsubscribeLive();
    unsubscribeLive = null;
  }

  async function paint(options = {}) {
    const query = typeof options === 'boolean' ? { force: options } : (options || {});
    const orders = await getOrders(query);

    if (!orders.length) {
      container.innerHTML = panel("Orders", "Live backend orders", emptyState("No orders found."));
      return;
    }

    const cards = orders.slice(0, 100).map(renderOrderCard).join("");
    container.innerHTML = `
      <div class="orders-page-grid">
        <section class="orders-hero-card">
          <p class="dashboard-eyebrow">Fulfillment</p>
          <h2>Orders</h2>
          <p>Customer, product, shipping, payment, and GPS details from checkout — including Cash on Delivery.</p>
          <div class="orders-hero-status-row">
            <span>${orders.length} orders loaded</span>
          </div>
        </section>
        <div class="orders-mobile-grid">${cards}</div>
      </div>
    `;
  }

  await paint({ force: true });

  container.onchange = async (event) => {
    const select = event.target?.closest?.("select[data-order-status]");
    if (!select) return;
    const orderId = select.getAttribute("data-order-status");
    const nextStatus = select.value;
    select.disabled = true;
    try {
      await updateOrderStatus(orderId, nextStatus);
      await paint({ force: true });
    } catch (error) {
      console.error(error);
      alert(error?.message || "Unable to update order status.");
      select.disabled = false;
    }
  };

  unsubscribeLive = subscribeToLiveFeeds("orders", () => {
    void paint({ preferCache: true, force: false });
  });
}
