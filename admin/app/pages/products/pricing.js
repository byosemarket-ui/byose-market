import { toNumber } from "./utils.js";

export function computeProductDiscount(pricing = {}) {
  const sellingPrice = Math.max(0, Math.floor(toNumber(pricing.sellingPrice, 0)));
  const originalInput = Math.max(0, Math.floor(toNumber(pricing.originalPrice, 0)));
  const originalPrice = originalInput > 0 ? originalInput : sellingPrice;
  const hasDiscount = originalPrice > sellingPrice && sellingPrice > 0;
  const discountAmount = hasDiscount ? originalPrice - sellingPrice : 0;
  const discountPercent = hasDiscount && originalPrice > 0
    ? Math.round((discountAmount / originalPrice) * 100)
    : 0;

  return {
    sellingPrice,
    originalPrice,
    oldPrice: hasDiscount ? originalPrice : 0,
    price: sellingPrice,
    discountAmount,
    discountPercent,
    hasDiscount
  };
}

export function formatDiscountBadgeLabel(discountPercent) {
  const value = Math.round(toNumber(discountPercent, 0));
  if (value <= 0) {
    return "";
  }
  return `-${value}%`;
}

export function renderAdminStorefrontPreview(summary, currency = "RWF", productName = "Product Preview") {
  const formatAmount = (value) => {
    const amount = Number(value || 0);
    if (currency === "USD") {
      return `$${amount.toLocaleString("en-US")}`;
    }
    if (currency === "EUR") {
      return `€${amount.toLocaleString("en-US")}`;
    }
    return `RWF ${amount.toLocaleString("en-US")}`;
  };

  const originalPrice = summary.originalPrice ?? summary.original ?? 0;
  const sellingPrice = summary.sellingPrice ?? summary.selling ?? summary.current ?? 0;
  const hasDiscount = Boolean(summary.hasDiscount ?? (originalPrice > sellingPrice && sellingPrice > 0));
  const discountPercent = summary.discountPercent ?? 0;

  const badge = hasDiscount && discountPercent > 0
    ? `<span class="pm-preview-discount-badge">${formatDiscountBadgeLabel(discountPercent)}</span>`
    : "";
  const oldPrice = hasDiscount
    ? `<span class="pm-preview-old-price">${formatAmount(originalPrice)}</span>`
    : "";

  return `
    <article class="pm-storefront-preview-card" data-pricing-card-preview aria-label="Storefront card preview">
      <div class="pm-storefront-preview-media">
        ${badge}
        <span class="pm-preview-wishlist" aria-hidden="true">♡</span>
        <div class="pm-storefront-preview-image" aria-hidden="true"></div>
      </div>
      <div class="pm-storefront-preview-body">
        <p class="pm-storefront-preview-name">${productName}</p>
        <p class="pm-storefront-preview-price">${formatAmount(sellingPrice)}</p>
        ${oldPrice}
      </div>
    </article>
  `;
}
