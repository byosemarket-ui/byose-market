/**
 * Shared storefront discount resolution for product cards and pricing display.
 */

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveProductDiscount(product) {
  const price = toNumber(product?.price ?? product?.salePrice ?? product?.currentPrice, 0);
  const compareCandidates = [
    product?.oldPrice,
    product?.compareAtPrice,
    product?.originalPrice,
    product?.metadata?.originalPrice
  ];

  let oldPrice = 0;
  for (const candidate of compareCandidates) {
    const parsed = toNumber(candidate, 0);
    if (parsed > price) {
      oldPrice = parsed;
      break;
    }
  }

  const hasDiscount = oldPrice > price && price > 0;
  const storedPercent = toNumber(product?.discountPercent ?? product?.metadata?.discountPercent, 0);
  const discountPercent = hasDiscount
    ? (storedPercent > 0
      ? Math.max(0, Math.min(100, Math.round(storedPercent)))
      : Math.round(((oldPrice - price) / oldPrice) * 100))
    : 0;

  return {
    price,
    oldPrice: hasDiscount ? oldPrice : 0,
    hasDiscount,
    discountPercent,
    discountAmount: hasDiscount ? oldPrice - price : 0
  };
}

export function formatDiscountBadgeLabel(discountPercent) {
  const value = Math.round(toNumber(discountPercent, 0));
  if (value <= 0) {
    return "";
  }
  return `-${value}%`;
}

export function buildDiscountedProductView(product) {
  const discount = resolveProductDiscount(product);
  return {
    ...product,
    price: discount.price,
    salePrice: discount.price,
    oldPrice: discount.oldPrice,
    originalPrice: discount.oldPrice,
    compareAtPrice: discount.oldPrice,
    discountPercent: discount.discountPercent
  };
}
