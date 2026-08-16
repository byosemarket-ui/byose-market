import { buildQrSvg } from "../utils/qr-svg.js";

const STOREFRONT_DEFAULTS = Object.freeze({
  storeName: "BYOSE Market",
  companyName: "BYOSE Market Ltd",
  supportEmail: "byosemarket@gmail.com",
  companyEmail: "byosemarket@gmail.com",
  supportPhone: "+250780430710",
  customerServicePhone: "+250780430710",
  country: "Rwanda",
  provinceCity: "Kigali",
  websiteUrl: "https://byosemarket.com",
  currency: "RWF",
  logoPath: "/img/logo.png"
});

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  if (value == null) return "";
  if (typeof value === "object") return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower === "undefined" || lower === "null" || lower === "[object object]") return "";
  return raw;
}

function uniqueText(value, used) {
  const raw = text(value);
  if (!raw) return "";
  const key = raw.replace(/\s+/g, " ").trim().toLowerCase();
  if (!key || used.has(key)) return "";
  used.add(key);
  return raw;
}

function pickText(...values) {
  for (let i = 0; i < values.length; i += 1) {
    const raw = text(values[i]);
    if (raw) return raw;
  }
  return "";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function titleCase(value, fallback = "") {
  const raw = text(value);
  if (!raw) return fallback;
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatMoney(value, currency = "RWF") {
  const amount = toNumber(value);
  const code = text(currency) || "RWF";
  return `${code} ${amount.toLocaleString("en-US")}`;
}

function formatDateParts(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) {
    return { date: "", time: "" };
  }
  return {
    date: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date),
    time: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date)
  };
}

function assetUrl(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return text(entry);
  return text(entry.url || entry.path);
}

function resolveOrigin() {
  if (typeof window === "undefined") return STOREFRONT_DEFAULTS.websiteUrl;
  const protocol = String(window.location?.protocol || "").toLowerCase();
  const origin = String(window.location?.origin || "").replace(/\/+$/, "");
  if ((protocol === "http:" || protocol === "https:") && origin) return origin;
  return STOREFRONT_DEFAULTS.websiteUrl;
}

function absUrl(value, origin = resolveOrigin()) {
  const raw = text(value);
  if (!raw) return "";
  if (/^(?:https?:|data:|blob:)/i.test(raw)) return raw;
  const base = String(origin || "").replace(/\/+$/, "");
  if (raw.startsWith("//")) return `${base.startsWith("https") ? "https:" : "http:"}${raw}`;
  if (raw.startsWith("/")) return `${base}${raw}`;
  if (raw.startsWith("uploads/") || raw.startsWith("img/")) return `${base}/${raw}`;
  if (/^(?:products|categories|users|reviews|hero|branding|temp)\//i.test(raw)) return `${base}/uploads/${raw}`;
  return `${base}/${raw.replace(/^\/+/, "")}`;
}

function displayWebsite(url) {
  const raw = text(url);
  if (!raw) return "";
  return raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function displayPhone(value) {
  const raw = text(value);
  if (!raw) return "";
  const digits = raw.replace(/\D+/g, "");
  if (digits.indexOf("250") === 0 && digits.length >= 12) {
    return `+${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9, 12)}`;
  }
  return raw;
}

function isPaidStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (!status) return false;
  if (
    status.includes("unpaid")
    || status.includes("awaiting")
    || status.includes("pending")
    || status.includes("fail")
    || status.includes("cancel")
    || status.includes("unsuccess")
    || status.includes("invalid")
    || status.includes("refund")
  ) {
    return false;
  }
  return status === "paid"
    || status === "success"
    || status === "successful"
    || status === "completed"
    || status === "complete"
    || status === "payment_successful"
    || status === "authorized";
}

function paymentMethodLabel(order) {
  const label = text(order?.paymentMethodLabel || order?.payment?.methodLabel);
  const method = String(order?.paymentMethod || order?.payment?.method || label || "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (method === "mtn" || method === "mtn_momo" || method === "momo") return "MTN MoMo";
  if (method === "airtel" || method === "airtel_money") return "Airtel Money";
  if (method === "card" || method === "visa" || method === "mastercard" || method === "visa_mastercard") return "Card";
  if (method === "bank" || method === "bank_transfer") return "Bank Transfer";
  if (method === "cod" || method === "cash" || method === "cash_on_delivery" || /cash on delivery/i.test(label)) {
    return "Cash on Delivery";
  }
  return label || titleCase(order?.paymentMethod, "");
}

function statusTone(value) {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("unpaid") || raw.includes("pending") || raw.includes("await")) return "warn";
  if (raw.includes("fail") || raw.includes("cancel") || raw.includes("refund")) return "danger";
  if (raw.includes("deliver") || raw.includes("complete") || (raw.includes("paid") && !raw.includes("unpaid"))) return "success";
  if (raw.includes("process") || raw.includes("ship") || raw.includes("pack") || raw.includes("confirm")) return "warn";
  return "neutral";
}

function icon(name) {
  const icons = {
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M12 21s7-6.2 7-11.2A7 7 0 1 0 5 9.8C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M6.5 3.8h3.2l1.3 3.2-2 1.2a12.5 12.5 0 0 0 6.8 6.8l1.2-2 3.2 1.3v3.2c0 .9-.8 1.7-1.7 1.7C9.8 19.2 4.8 14.2 4.8 5.5c0-.9.8-1.7 1.7-1.7z"/></svg>',
    email: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="none" stroke="currentColor" stroke-width="1.8" d="m4 7 8 6 8-6"/></svg>',
    globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="none" stroke="currentColor" stroke-width="1.8" d="M3.8 12h16.4M12 3.8c2.4 2.6 3.6 5.4 3.6 8.2S14.4 17.6 12 20.2C9.6 17.6 8.4 14.8 8.4 12S9.6 6.4 12 3.8z"/></svg>',
    user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="none" stroke="currentColor" stroke-width="1.8" d="M5.5 19.2c.8-3.2 3.3-5 6.5-5s5.7 1.8 6.5 5"/></svg>',
    truck: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M3.5 16.5V7.5h11v9m0 0h2.2l3.8-3.8V9.8H14.5"/><circle cx="7.2" cy="17.2" r="1.6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="16.8" cy="17.2" r="1.6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    card: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.2" y="6" width="17.6" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="none" stroke="currentColor" stroke-width="1.8" d="M3.2 10h17.6"/></svg>',
    list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M8 7h12M8 12h12M8 17h12"/><circle cx="4.5" cy="7" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="17" r="1" fill="currentColor"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="none" stroke="currentColor" stroke-width="1.8" d="m8.2 12.2 2.6 2.6 5-5.2"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="none" stroke="currentColor" stroke-width="1.8" d="M3.5 10h17M8 3.8v3.4M16 3.8v3.4"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="none" stroke="currentColor" stroke-width="1.8" d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    seal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M12 3.5 14.2 8l4.8.7-3.5 3.4.8 4.8L12 15.6 7.7 16.9l.8-4.8L5 8.7 9.8 8z"/></svg>'
  };
  return icons[name] || "";
}

export function resolveInvoiceCompany(settings = {}, branding = {}) {
  const general = asObject(settings);
  const brand = asObject(branding);
  const logos = asObject(brand.logos);
  const colors = asObject(brand.colors);
  const identity = asObject(brand.identity);
  const origin = resolveOrigin();
  const phone = pickText(general.supportPhone, general.customerServicePhone, STOREFRONT_DEFAULTS.supportPhone);
  const email = pickText(general.supportEmail, general.companyEmail, general.defaultSupportEmail, STOREFRONT_DEFAULTS.supportEmail);
  const website = pickText(general.websiteUrl, STOREFRONT_DEFAULTS.websiteUrl);
  const city = pickText(general.provinceCity, STOREFRONT_DEFAULTS.provinceCity);
  const country = pickText(general.country, STOREFRONT_DEFAULTS.country);
  const address = pickText(general.companyAddress) || [city, country].filter(Boolean).join(", ");
  const logo = absUrl(
    assetUrl(logos.mainLogo) || assetUrl(logos.emailLogo) || assetUrl(logos.darkLogo) || assetUrl(logos.adminLogo) || STOREFRONT_DEFAULTS.logoPath,
    origin
  );
  return {
    storeName: pickText(general.storeName, STOREFRONT_DEFAULTS.storeName),
    companyName: pickText(general.companyName, STOREFRONT_DEFAULTS.companyName),
    phone,
    phoneDisplay: displayPhone(phone),
    email,
    website,
    websiteDisplay: displayWebsite(website),
    address,
    city,
    country,
    currency: pickText(general.currency, STOREFRONT_DEFAULTS.currency) || "RWF",
    logo,
    primary: text(colors.primary) || "#00B894",
    tagline: text(identity.tagline),
    origin
  };
}

function resolveCustomer(order) {
  const ship = asObject(order?.shippingAddress || order?.deliveryAddress);
  const customer = asObject(order?.customer);
  return {
    name: pickText(ship.fullName, order?.customerName, customer.name, customer.fullName),
    phone: pickText(ship.phone, order?.customerPhone, order?.phoneNumber, customer.phone),
    email: pickText(order?.customerEmail, order?.userEmail, customer.email, ship.email),
    customerId: pickText(order?.customerId, customer.id, customer.customerId)
  };
}

function resolveAddress(order) {
  const ship = asObject(order?.shippingAddress || order?.deliveryAddress);
  const full = asObject(order?.fullAddress);
  const used = new Set();
  const province = uniqueText(pickText(ship.provinceCity, ship.province, ship.city, full.provinceCity, full.province, full.city, order?.provinceCity), used);
  const district = uniqueText(pickText(ship.district, full.district), used);
  const sector = uniqueText(pickText(ship.sector, full.sector), used);
  const cell = uniqueText(pickText(ship.cell, full.cell), used);
  const village = uniqueText(pickText(ship.village, full.village), used);
  const street = uniqueText(pickText(ship.street, ship.line1, full.street, full.line1), used);
  const house = uniqueText(pickText(ship.houseNumber, ship.houseNo, ship.house, full.houseNumber, full.house), used);
  const building = uniqueText(pickText(ship.building, full.building), used);
  const apartment = uniqueText(pickText(ship.apartment, ship.apt, full.apartment), used);
  const additional = uniqueText(pickText(ship.additionalAddress, ship.additional, full.additionalAddress, ship.addressLine, full.addressLine), used);
  const landmark = uniqueText(pickText(ship.note, full.note, ship.landmark, full.landmark), used);
  return {
    province,
    district,
    sector,
    cell,
    village,
    street,
    house,
    building,
    apartment,
    additional,
    landmark,
    hasAny: Boolean(province || district || sector || cell || village || street || house || building || apartment || additional || landmark)
  };
}

function resolveNotes(order, address) {
  const ship = asObject(order?.shippingAddress || order?.deliveryAddress);
  const used = new Set();
  [address?.landmark, address?.additional].forEach((value) => {
    const key = text(value).replace(/\s+/g, " ").trim().toLowerCase();
    if (key) used.add(key);
  });
  return {
    instructions: uniqueText(pickText(ship.deliveryInstructions, order?.deliveryInstructions, ship.instructions), used),
    notes: uniqueText(pickText(order?.customerMessage, order?.orderNotes, order?.checkoutNotes, ship.customerNotes, order?.buyerNotes), used)
  };
}

function resolveLocation(order) {
  const gps = asObject(order?.gpsLocation);
  const ship = asObject(order?.shippingAddress || order?.deliveryAddress);
  const latitude = pickText(gps.latitude, ship.latitude, order?.latitude);
  const longitude = pickText(gps.longitude, ship.longitude, order?.longitude);
  const explicit = pickText(gps.googleMapsLink, gps.mapLink, ship.mapLink);
  const latNum = Number(latitude);
  const lngNum = Number(longitude);
  const hasCoords = latitude !== "" && longitude !== "" && Number.isFinite(latNum) && Number.isFinite(lngNum) && !(latNum === 0 && lngNum === 0);
  const mapLink = explicit || (hasCoords ? `https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}` : "");
  return {
    latitude: hasCoords ? latitude : "",
    longitude: hasCoords ? longitude : "",
    mapLink,
    hasAny: Boolean(hasCoords || mapLink)
  };
}

function resolveItems(order, origin) {
  return asArray(order?.items || order?.products).map((item) => {
    const attrs = asObject(item?.attributes);
    const quantity = Math.max(1, toNumber(item?.quantity || item?.qty || 1));
    const price = toNumber(item?.price ?? item?.soldPrice ?? item?.unitPrice);
    const storedLine = item?.lineTotal != null && item?.lineTotal !== "" ? toNumber(item.lineTotal) : 0;
    const image = absUrl(pickText(item?.image, item?.colorImage, attrs.colorImage), origin);
    return {
      productName: pickText(item?.productName, item?.name) || "Product",
      productId: pickText(item?.productId, item?.id),
      sku: pickText(item?.sku, item?.variantSku, attrs.SKU),
      variant: pickText(item?.variant, item?.variantKey, attrs.Variant, attrs.variant),
      size: pickText(item?.size, item?.sizeLabel, attrs.Size),
      color: pickText(item?.color, item?.colorName, attrs.Color),
      model: pickText(item?.model, attrs.Model, attrs.model),
      quantity,
      price,
      lineTotal: storedLine > 0 ? storedLine : price * quantity,
      image
    };
  });
}

function normalizeStatusKey(value) {
  return String(value || "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function isConfirmedDeliveryStatus(value) {
  const status = normalizeStatusKey(value);
  if (!status) return false;
  if (/(cancel|return|refund)/.test(status)) return false;
  if (/(out for delivery|ready for delivery|awaiting delivery|pending delivery)/.test(status)) return false;
  return status === "delivered"
    || status === "completed"
    || status === "complete"
    || /\bdelivered\b/.test(status)
    || /\bcompleted\b/.test(status);
}

function isDeliveryConfirmed(order) {
  return [
    order?.deliveryStatus,
    order?.shippingStatus,
    order?.status,
    order?.orderStatus
  ].some((value) => isConfirmedDeliveryStatus(value));
}

function resolveCompletionDate(order) {
  const history = asArray(order?.statusHistory);
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index] || {};
    if (/deliver|complete/i.test(`${entry.status || ""} ${entry.label || ""}`)) {
      return entry.timestamp || "";
    }
  }
  if (/deliver|complete/i.test(String(order?.status || order?.orderStatus || ""))) {
    return order.updatedAt || order.date || order.createdAt || "";
  }
  return "";
}

function dlRows(rows) {
  return rows
    .filter((row) => row && text(row.label) && text(row.value))
    .map((row) => `
      <div class="inv-field">
        <span>${escapeHtml(row.label)}</span>
        <strong class="${row.wrap ? "is-wrap" : ""}">${row.html ? row.value : escapeHtml(row.value)}</strong>
      </div>
    `)
    .join("");
}

function badge(label, tone) {
  const safe = text(label);
  if (!safe) return "";
  return `<span class="inv-badge inv-badge--${escapeHtml(tone || statusTone(safe))}">${escapeHtml(safe)}</span>`;
}

function sectionTitle(name, label) {
  return `<h2 class="inv-section-title">${icon(name)}<span>${escapeHtml(label)}</span></h2>`;
}

function buildInvoiceCss(primary) {
  const color = text(primary) || "#00B894";
  return `
    :root {
      --inv: ${color};
      --inv-dark: #0f3d2e;
      --inv-text: #1f2a37;
      --inv-muted: #5b6b7c;
      --inv-line: #e5e7eb;
      --inv-soft: #f4f7f6;
      --inv-head: #e7f6ef;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #eef2f0; color: var(--inv-text); }
    body { font-family: Inter, Manrope, "Segoe UI", Roboto, Arial, sans-serif; }
    .inv-toolbar {
      position: sticky; top: 0; z-index: 20;
      display: flex; gap: 10px; align-items: center; justify-content: space-between;
      padding: 12px 18px; background: #10261c; color: #fff;
    }
    .inv-toolbar p { margin: 0; font-size: 13px; opacity: .85; }
    .inv-toolbar-actions { display: flex; gap: 8px; }
    .inv-toolbar button {
      border: 0; border-radius: 8px; padding: 9px 14px; font-weight: 700; cursor: pointer;
    }
    .inv-toolbar .is-primary { background: var(--inv); color: #072117; }
    .inv-toolbar .is-ghost { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,.3); }
    .inv-sheet {
      width: 210mm; max-width: 100%;
      margin: 18px auto; background: #fff; color: var(--inv-text);
      padding: 14mm 14mm 12mm; box-shadow: 0 10px 40px rgba(16,38,28,.12);
    }
    .inv-header {
      display: grid; grid-template-columns: 120px 1fr 210px; gap: 18px; align-items: center;
      padding-bottom: 16px; border-bottom: 2px solid var(--inv);
    }
    .inv-logo { max-width: 118px; max-height: 72px; width: auto; height: auto; object-fit: contain; display: block; }
    .inv-header-main { text-align: center; }
    .inv-kicker { margin: 0; font-size: 13px; letter-spacing: .16em; font-weight: 800; color: var(--inv-dark); }
    .inv-title { margin: 4px 0 0; font-size: 22px; line-height: 1.2; color: var(--inv-dark); letter-spacing: .02em; }
    .inv-sub { margin: 6px 0 0; color: var(--inv-muted); font-size: 12px; }
    .inv-company { display: grid; gap: 6px; font-size: 12px; color: var(--inv-text); }
    .inv-company-row { display: grid; grid-template-columns: 16px 1fr; gap: 8px; align-items: start; }
    .inv-company-row svg { width: 14px; height: 14px; color: var(--inv-dark); margin-top: 1px; }
    .inv-meta {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
      margin: 16px 0; padding: 12px 14px; border: 1px solid var(--inv-line); border-radius: 10px;
    }
    .inv-meta-item span { display: block; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--inv-muted); font-weight: 700; }
    .inv-meta-item strong { display: block; margin-top: 4px; font-size: 13px; word-break: break-word; }
    .inv-meta-copy { display: inline-flex; align-items: center; gap: 6px; }
    .inv-meta-copy svg { width: 13px; height: 13px; color: var(--inv-muted); }
    .inv-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0; margin: 8px 0 18px; border: 1px solid var(--inv-line); border-radius: 10px; overflow: hidden; }
    .inv-col { padding: 14px 16px; min-width: 0; }
    .inv-col + .inv-col { border-left: 1px solid var(--inv-line); }
    .inv-section-title { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--inv-dark); }
    .inv-section-title svg { width: 16px; height: 16px; }
    .inv-field { display: grid; grid-template-columns: 118px 1fr; gap: 8px; padding: 4px 0; font-size: 12px; align-items: start; }
    .inv-field span { color: var(--inv-muted); }
    .inv-field strong { font-weight: 700; overflow-wrap: anywhere; }
    .inv-field strong.is-wrap { white-space: pre-wrap; }
    .inv-link { color: var(--inv-dark); font-weight: 700; text-decoration: none; }
    .inv-table-wrap { overflow-x: auto; margin: 6px 0 18px; border: 1px solid var(--inv-line); border-radius: 10px; }
    table.inv-items { width: 100%; border-collapse: collapse; min-width: 640px; }
    .inv-items thead { display: table-header-group; }
    .inv-items tr { break-inside: avoid; page-break-inside: avoid; }
    .inv-items th { background: var(--inv-head); color: var(--inv-dark); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; text-align: left; padding: 9px 8px; }
    .inv-items td { padding: 9px 8px; border-top: 1px solid var(--inv-line); font-size: 12px; vertical-align: middle; overflow-wrap: anywhere; }
    .inv-items td.num, .inv-items th.num { text-align: right; white-space: nowrap; }
    .inv-product { display: grid; grid-template-columns: 44px 1fr; gap: 8px; align-items: center; }
    .inv-product > div { width: 44px; height: 44px; }
    .inv-product img, .inv-ph {
      width: 44px; height: 44px; object-fit: contain; background: var(--inv-soft);
      border: 1px solid var(--inv-line); border-radius: 8px;
    }
    .inv-ph { display: grid; place-items: center; font-weight: 800; color: var(--inv-dark); }
    .inv-pay-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 18px; }
    .inv-card { border: 1px solid var(--inv-line); border-radius: 10px; padding: 14px 16px; }
    .inv-sum-row { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; font-size: 13px; }
    .inv-sum-row.is-total { border-top: 1px solid var(--inv-line); margin-top: 8px; padding-top: 10px; color: var(--inv-dark); font-size: 18px; }
    .inv-sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; page-break-inside: avoid; }
    .inv-sign-box { border: 1px solid var(--inv-line); border-radius: 10px; padding: 14px 16px; min-height: 210px; }
    .inv-statement { font-size: 12px; line-height: 1.55; color: var(--inv-text); margin: 0 0 14px; }
    .inv-sign-line { margin: 10px 0 0; font-size: 12px; }
    .inv-sign-line span { display: block; color: var(--inv-muted); margin-bottom: 6px; }
    .inv-blank { border-bottom: 1px solid #94a3b8; min-height: 28px; }
    .inv-blank.is-tall { min-height: 46px; }
    .inv-policy { margin: 10px 0 0; font-size: 11px; color: var(--inv-muted); line-height: 1.45; }
    .inv-footer {
      display: grid; grid-template-columns: 1fr 150px; gap: 16px; align-items: center;
      margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--inv-line);
    }
    .inv-thanks { display: grid; grid-template-columns: 28px 1fr; gap: 10px; align-items: start; }
    .inv-thanks svg { width: 26px; height: 26px; color: var(--inv); }
    .inv-thanks h3 { margin: 0; font-size: 13px; letter-spacing: .06em; color: var(--inv-dark); }
    .inv-thanks p { margin: 4px 0 0; font-size: 11px; color: var(--inv-muted); line-height: 1.45; }
    .inv-qr { justify-self: end; background: #fff; padding: 8px; border: 1px solid var(--inv-line); border-radius: 8px; }
    .inv-qr svg { display: block; width: 148px; height: 148px; }
    .inv-qr-caption { margin: 6px 0 0; font-size: 10px; text-align: center; color: var(--inv-muted); letter-spacing: .04em; }
    .inv-badge { display: inline-block; border-radius: 999px; padding: 3px 9px; font-size: 11px; font-weight: 800; }
    .inv-badge--success { background: #e7f8ee; color: #0f7a43; }
    .inv-badge--warn { background: #fff4e5; color: #b45309; }
    .inv-badge--danger { background: #fdecec; color: #b42318; }
    .inv-badge--neutral { background: var(--inv-soft); color: var(--inv-dark); }
    @media screen and (max-width: 800px) {
      .inv-sheet { margin: 0; padding: 18px; width: 100%; box-shadow: none; }
      .inv-header, .inv-meta, .inv-grid-3, .inv-pay-grid, .inv-sign-grid, .inv-footer { grid-template-columns: 1fr; }
      .inv-header-main, .inv-company { text-align: left; }
      .inv-col + .inv-col { border-left: 0; border-top: 1px solid var(--inv-line); }
      .inv-qr { justify-self: start; }
    }
    @media print {
      .inv-toolbar, .inv-toolbar-actions, .inv-toolbar button { display: none !important; }
      html, body { background: #fff !important; }
      .inv-sheet { width: auto; margin: 0; padding: 0; box-shadow: none; }
      a[href]::after { content: none !important; }
      .inv-meta-copy svg { display: none; }
      html, body { overflow: visible !important; }
      table.inv-items { min-width: 0; width: 100%; }
      .inv-table-wrap { overflow: visible; }
      .inv-header, .inv-section-title { break-after: avoid; page-break-after: avoid; }
      .inv-items thead { display: table-header-group; }
      .inv-items tfoot { display: table-footer-group; }
      .inv-items tr, .inv-product, .inv-sign-grid, .inv-sign-box, .inv-footer, .inv-qr, .inv-sum-row.is-total, .inv-pay-grid { break-inside: avoid; page-break-inside: avoid; }
      .inv-qr { padding: 10px; background: #fff !important; }
      .inv-qr svg { width: 32mm !important; height: 32mm !important; }
      img { max-width: 100%; object-fit: contain; }
      img, .inv-badge, .inv-items th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    @page { size: A4; margin: 10mm; }
  `;
}

function renderHeader(company) {
  return `
    <header class="inv-header">
      <div>${company.logo ? `<img class="inv-logo" src="${escapeHtml(company.logo)}" alt="${escapeHtml(company.storeName)} logo">` : ""}</div>
      <div class="inv-header-main">
        <p class="inv-kicker">${escapeHtml(company.storeName.toUpperCase())}</p>
        <h1 class="inv-title">INVOICE &amp; DELIVERY CONFIRMATION</h1>
        <p class="inv-sub">Thank you for shopping with ${escapeHtml(company.storeName.toUpperCase())}</p>
      </div>
      <div class="inv-company">
        ${company.companyName ? `<div class="inv-company-row">${icon("pin")}<span>${escapeHtml([company.companyName, company.address].filter(Boolean).join(", "))}</span></div>` : ""}
        ${company.phoneDisplay ? `<div class="inv-company-row">${icon("phone")}<span>${escapeHtml(company.phoneDisplay)}</span></div>` : ""}
        ${company.email ? `<div class="inv-company-row">${icon("email")}<span>${escapeHtml(company.email)}</span></div>` : ""}
        ${company.websiteDisplay ? `<div class="inv-company-row">${icon("globe")}<span>${escapeHtml(company.websiteDisplay)}</span></div>` : ""}
      </div>
    </header>
  `;
}

export function buildInvoiceHtml(order, options = {}) {
  const company = options.company && options.company.storeName
    ? options.company
    : resolveInvoiceCompany(options.settings, options.branding);
  const origin = company.origin || resolveOrigin();
  const currency = pickText(order?.currency, company.currency, "RWF") || "RWF";
  const identifiers = {
    orderNumber: pickText(order?.orderId, order?.id),
    internalId: ""
  };
  const recordId = Number(order?.recordId);
  const legacyId = pickText(order?.id);
  if (Number.isFinite(recordId) && recordId > 0 && String(recordId) !== identifiers.orderNumber) {
    identifiers.internalId = String(recordId);
  } else if (legacyId && legacyId !== identifiers.orderNumber) {
    identifiers.internalId = legacyId;
  }

  const when = formatDateParts(order?.date || order?.createdAt);
  const paymentStatus = titleCase(order?.paymentStatusLabel || order?.paymentStatus, "Pending");
  const deliveryStatus = titleCase(order?.deliveryStatus || order?.shippingStatus || order?.status || order?.orderStatus, "Pending");
  const customer = resolveCustomer(order);
  const address = resolveAddress(order);
  const notes = resolveNotes(order, address);
  const location = resolveLocation(order);
  const items = resolveItems(order, origin);
  const method = paymentMethodLabel(order);
  const paid = isPaidStatus(order?.paymentStatusLabel || order?.paymentStatus);
  const total = toNumber(order?.grandTotal ?? order?.total ?? order?.totalAmount);
  const subtotal = toNumber(order?.subtotal);
  const deliveryFee = toNumber(order?.deliveryFee ?? order?.shippingFee ?? order?.shippingCost);
  const discount = toNumber(order?.couponDiscount || order?.discount);
  const tax = toNumber(order?.tax);
  const codFee = toNumber(order?.codFee);
  const payment = asObject(order?.payment);
  const gateway = asObject(payment.gateway);
  const transaction = asObject(payment.transaction);
  const transactionId = pickText(order?.transactionId, gateway.transRef, payment.transactionId, transaction.reference);
  const paymentRef = pickText(order?.paymentReference, order?.transactionReference, payment.reference, gateway.companyRef);
  const paidAt = formatDateParts(pickText(gateway.verifiedAt, gateway.updatedAt, payment.paidAt, payment.confirmedAt));
  const deliveredAt = isDeliveryConfirmed(order)
    ? formatDateParts(resolveCompletionDate(order))
    : { date: "", time: "" };
  const estimateRaw = pickText(order?.deliveryEstimate, order?.estimatedDelivery, options.estimatedDelivery);
  const estimate = formatDateParts(estimateRaw);
  const estimateLabel = estimate.date || text(estimateRaw);
  const staffName = text(options.assignedStaff);
  const verifyUrl = text(options.verificationUrl);
  const qrSvg = (() => {
    const serverSvg = text(options.qrSvg).trim();
    if (serverSvg && /^<svg[\s>]/i.test(serverSvg) && !/<script/i.test(serverSvg)) {
      return serverSvg;
    }
    return verifyUrl ? buildQrSvg(verifyUrl, { size: 180, margin: 4 }) : "";
  })();
  const deliveryConfirmed = isDeliveryConfirmed(order);
  const confirmationLabel = deliveryConfirmed ? "Received / Confirmed" : "Pending";

  const itemColumns = {
    variant: items.some((item) => item.variant),
    size: items.some((item) => item.size),
    color: items.some((item) => item.color),
    model: items.some((item) => item.model),
    sku: items.some((item) => item.sku || item.productId)
  };

  const summaryRows = [];
  if (subtotal > 0 || items.length) summaryRows.push(["Subtotal", formatMoney(subtotal > 0 ? subtotal : items.reduce((sum, item) => sum + item.lineTotal, 0), currency)]);
  if (discount > 0) summaryRows.push(["Discount", `− ${formatMoney(discount, currency)}`]);
  if (deliveryFee > 0 || pickText(order?.deliveryMethod, order?.deliveryLabel)) summaryRows.push(["Delivery Fee", formatMoney(deliveryFee, currency)]);
  if (tax > 0) summaryRows.push(["Tax", formatMoney(tax, currency)]);
  if (codFee > 0) summaryRows.push(["Other Charges", formatMoney(codFee, currency)]);

  const streetHouse = [address.street, address.house].filter(Boolean).join(", ");
  const buildingApt = [address.building, address.apartment].filter(Boolean).join(", ");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <base href="${escapeHtml(`${origin}/`)}" />
  <title>${escapeHtml(`${company.storeName} · Invoice ${identifiers.orderNumber || ""}`.trim())}</title>
  <style>${buildInvoiceCss(company.primary)}</style>
</head>
<body>
  <div class="inv-toolbar">
    <p>Invoice &amp; Delivery Confirmation${identifiers.orderNumber ? ` · ${escapeHtml(identifiers.orderNumber)}` : ""}</p>
    <div class="inv-toolbar-actions">
      <button type="button" class="is-primary" onclick="window.print()">Print Invoice</button>
      <button type="button" class="is-ghost" onclick="window.print()">Save as PDF</button>
      <button type="button" class="is-ghost" onclick="window.close()">Close</button>
    </div>
  </div>
  <article class="inv-sheet" data-invoice-order="${escapeHtml(identifiers.orderNumber)}">
    ${renderHeader(company)}
    <section class="inv-meta">
      <div class="inv-meta-item">
        <span>Order Number</span>
        <strong class="inv-meta-copy">${identifiers.orderNumber ? `#${escapeHtml(identifiers.orderNumber)}` : "Not provided"} ${icon("copy")}</strong>
      </div>
      <div class="inv-meta-item">
        <span>Order Date</span>
        <strong>${when.date ? `${escapeHtml(when.date)}${when.time ? `<br>${escapeHtml(when.time)}` : ""}` : "Not provided"}</strong>
      </div>
      <div class="inv-meta-item">
        <span>Payment Status</span>
        <strong>${badge(paymentStatus, paid ? "success" : statusTone(paymentStatus))}</strong>
      </div>
      <div class="inv-meta-item">
        <span>Delivery Status</span>
        <strong>${badge(deliveryStatus)}</strong>
      </div>
    </section>
    ${identifiers.internalId ? `<p class="inv-sub" style="margin-top:-8px">Order ID: ${escapeHtml(identifiers.internalId)}</p>` : ""}

    <section class="inv-grid-3">
      <div class="inv-col">
        ${sectionTitle("user", "Customer Information")}
        ${dlRows([
          { label: "Name", value: customer.name },
          { label: "Customer ID", value: customer.customerId },
          { label: "Phone", value: customer.phone || "Not provided" },
          { label: "Email", value: customer.email },
          { label: "Province / City", value: address.province },
          { label: "District", value: address.district },
          { label: "Sector", value: address.sector },
          { label: "Cell", value: address.cell },
          { label: "Village", value: address.village },
          { label: "Street / House", value: streetHouse },
          { label: "Building / Apartment", value: buildingApt },
          { label: "Additional Address", value: address.additional },
          { label: "Delivery Instructions", value: notes.instructions, wrap: true },
          { label: "Customer Notes", value: notes.notes, wrap: true }
        ])}
      </div>
      <div class="inv-col">
        ${sectionTitle("pin", "Delivery Location")}
        ${address.hasAny ? dlRows([
          { label: "Province / City", value: address.province },
          { label: "District", value: address.district },
          { label: "Sector", value: address.sector },
          { label: "Cell", value: address.cell },
          { label: "Village", value: address.village },
          { label: "Street / House", value: streetHouse },
          { label: "Building / Apartment", value: buildingApt },
          { label: "Additional Address", value: address.additional },
          { label: "Landmark", value: address.landmark },
          { label: "Delivery Instructions", value: notes.instructions, wrap: true }
        ]) : dlRows([{ label: "Address", value: "Not provided" }])}
        ${location.mapLink ? `<p><a class="inv-link" href="${escapeHtml(location.mapLink)}" target="_blank" rel="noopener noreferrer">View Location on Map</a></p>` : ""}
        ${location.latitude && location.longitude ? `<p class="inv-sub">GPS: ${escapeHtml(location.latitude)}, ${escapeHtml(location.longitude)}</p>` : ""}
      </div>
      <div class="inv-col">
        ${sectionTitle("truck", "Delivery Information")}
        ${dlRows([
          { label: "Delivery Method", value: titleCase(order?.deliveryLabel || (order?.deliveryMethod === "delivery" ? "Home Delivery" : order?.deliveryMethod), "") },
          { label: "Delivery Status", value: deliveryStatus },
          { label: "Delivery Fee", value: (deliveryFee > 0 || pickText(order?.deliveryMethod, order?.deliveryLabel)) ? formatMoney(deliveryFee, currency) : "" },
          { label: "Delivery Provider", value: pickText(order?.deliveryProvider) },
          { label: "Tracking Number", value: pickText(order?.trackingNumber) },
          { label: "Estimated Delivery", value: estimate.date ? [estimate.date, estimate.time].filter(Boolean).join(" · ") : estimateLabel },
          { label: "Delivered On", value: deliveredAt.date ? [deliveredAt.date, deliveredAt.time].filter(Boolean).join(" · ") : "" },
          { label: "Customer Confirmation", value: confirmationLabel }
        ])}
      </div>
    </section>

    <h2 class="inv-section-title">${icon("list")}<span>Order Items</span></h2>
    <div class="inv-table-wrap">
      <table class="inv-items">
        <thead>
          <tr>
            <th>#</th>
            <th>Product</th>
            ${itemColumns.sku ? "<th>Product ID / SKU</th>" : ""}
            ${itemColumns.variant ? "<th>Variant</th>" : ""}
            ${itemColumns.size ? "<th>Size</th>" : ""}
            ${itemColumns.color ? "<th>Color</th>" : ""}
            ${itemColumns.model ? "<th>Model</th>" : ""}
            <th class="num">Qty</th>
            <th class="num">Unit Price</th>
            <th class="num">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${items.length ? items.map((item, index) => `
            <tr>
              <td>${index + 1}</td>
              <td>
                <div class="inv-product">
                  <div>
                    ${item.image
                      ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.productName)}" onerror="this.removeAttribute('onerror');this.style.display='none';var fb=this.nextElementSibling;if(fb)fb.style.display='grid';">`
                      : ""}
                    <div class="inv-ph" ${item.image ? 'style="display:none"' : ""} aria-hidden="true">${escapeHtml((item.productName || "P").slice(0, 1).toUpperCase())}</div>
                  </div>
                  <strong>${escapeHtml(item.productName)}</strong>
                </div>
              </td>
              ${itemColumns.sku ? `<td>${escapeHtml([item.productId && `ID: ${item.productId}`, item.sku && `SKU: ${item.sku}`].filter(Boolean).join(" · ") || "—")}</td>` : ""}
              ${itemColumns.variant ? `<td>${escapeHtml(item.variant || "—")}</td>` : ""}
              ${itemColumns.size ? `<td>${escapeHtml(item.size || "—")}</td>` : ""}
              ${itemColumns.color ? `<td>${escapeHtml(item.color || "—")}</td>` : ""}
              ${itemColumns.model ? `<td>${escapeHtml(item.model || "—")}</td>` : ""}
              <td class="num">${escapeHtml(item.quantity)}</td>
              <td class="num">${escapeHtml(formatMoney(item.price, currency))}</td>
              <td class="num">${escapeHtml(formatMoney(item.lineTotal, currency))}</td>
            </tr>
          `).join("") : `<tr><td colspan="8">No products on this order.</td></tr>`}
        </tbody>
      </table>
    </div>

    <section class="inv-pay-grid">
      <div class="inv-card">
        ${sectionTitle("card", "Payment Information")}
        ${dlRows([
          { label: "Payment Method", value: method },
          { label: "Payment Status", value: paymentStatus },
          { label: "Amount Paid", value: formatMoney(paid ? total : 0, currency) },
          { label: "Amount Due", value: formatMoney(paid ? 0 : total, currency) },
          { label: "Currency", value: currency },
          { label: "Transaction ID", value: transactionId },
          { label: "Payment Reference", value: paymentRef && paymentRef !== transactionId ? paymentRef : "" },
          { label: "Payment Date", value: paidAt.date ? [paidAt.date, paidAt.time].filter(Boolean).join(" · ") : "" }
        ])}
      </div>
      <div class="inv-card">
        ${sectionTitle("list", "Order Summary")}
        ${summaryRows.map(([label, value]) => `<div class="inv-sum-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
        <div class="inv-sum-row is-total"><span>TOTAL AMOUNT</span><strong>${escapeHtml(formatMoney(total, currency))}</strong></div>
      </div>
    </section>

    <section class="inv-sign-grid">
      <div class="inv-sign-box">
        ${sectionTitle("check", "Customer Delivery Confirmation")}
        <p>${badge(confirmationLabel, deliveryConfirmed ? "success" : "warn")}</p>
        <p class="inv-statement">I confirm that I have received the products listed in this order, in the quantities and selected sizes, colours, and variants shown, and that delivery was made to the delivery location I provided. I have inspected this delivery. This acknowledgement confirms receipt of the order. It does not cancel my rights under the BYOSE Market return and refund policy.</p>
        <div class="inv-sign-line"><span>Customer Name</span><div class="inv-blank">${escapeHtml(customer.name)}</div></div>
        <div class="inv-sign-line"><span>Customer Signature</span><div class="inv-blank is-tall"></div></div>
        <div class="inv-sign-line"><span>Date Received</span><div class="inv-blank">____ / ____ / ______</div></div>
        <div class="inv-sign-line"><span>Time Received</span><div class="inv-blank">________ : ________</div></div>
        <p class="inv-policy">Opening or printing this invoice does not mark the order delivered or paid. Payment status remains ${escapeHtml(paymentStatus)} until confirmed through the BYOSE Market payment process. A customer signature confirms receipt only and does not cancel legitimate return or refund rights.</p>
      </div>
      <div class="inv-sign-box">
        ${sectionTitle("user", "Delivered By")}
        <div class="inv-sign-line"><span>Name</span><div class="inv-blank">${escapeHtml(staffName)}</div></div>
        <div class="inv-sign-line"><span>Phone</span><div class="inv-blank"></div></div>
        <div class="inv-sign-line"><span>Signature</span><div class="inv-blank is-tall"></div></div>
        <div class="inv-sign-line"><span>Date</span><div class="inv-blank">____ / ____ / ______</div></div>
        <div class="inv-sign-line"><span>Time</span><div class="inv-blank">________ : ________</div></div>
      </div>
    </section>

    <footer class="inv-footer">
      <div class="inv-thanks">
        ${icon("seal")}
        <div>
          <h3>THANK YOU FOR CHOOSING ${escapeHtml(company.storeName.toUpperCase())}</h3>
          <p>This document serves as an invoice, customer receipt, and delivery confirmation. ${escapeHtml([company.companyName, company.address, company.phoneDisplay, company.email, company.websiteDisplay].filter(Boolean).join(" · "))}</p>
        </div>
      </div>
      ${qrSvg ? `<div class="inv-qr" data-verify-url="${escapeHtml(verifyUrl)}" title="Scan to verify this invoice">${qrSvg}<p class="inv-qr-caption">Scan to verify</p></div>` : ""}
    </footer>
  </article>
</body>
</html>`;

  return html;
}

export function openInvoiceDocument(order, options = {}) {
  if (!order) return false;
  const html = buildInvoiceHtml(order, options);
  const invoiceWindow = options.targetWindow || window.open("", "_blank", "width=1200,height=900");
  if (!invoiceWindow) return false;
  invoiceWindow.document.open();
  invoiceWindow.document.write(html);
  invoiceWindow.document.close();
  invoiceWindow.focus();
  if (options.autoPrint === true) {
    window.setTimeout(() => {
      try {
        invoiceWindow.print();
      } catch (_error) {
        // Ignore print failures in restricted browsers.
      }
    }, 350);
  }
  return true;
}
