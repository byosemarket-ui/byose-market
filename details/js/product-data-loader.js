import { getAllProductContent, getCachedProductContent, getProductContentById } from './product-content.js';
import {
  isProductCardImageUrl,
  normalizeStorefrontAssetList,
  normalizeStorefrontAssetUrl,
  resolveProductDisplayImage,
  resolveProductImageUrl,
  toProductCardImageUrl
} from '../../services/storefront-asset-url.js';
import { buildDiscountedProductView } from '../../js/storefront-discount.js';
import { computeProductTotalStock, extractColorVariantsFromProduct } from '../../js/color-variant-inventory.js';

async function getCatalog() {
  const detailCatalog = await getAllProductContent();
  return Array.isArray(detailCatalog) ? detailCatalog : [];
}

function splitDescriptionParagraphs(value) {
  if (Array.isArray(value) && value.length) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }

  const text = String(value || "").trim();
  if (!text) {
    return [];
  }

  return text.split(/\n{2,}|\r\n{2,}/).map((entry) => entry.trim()).filter(Boolean);
}

function titleCase(value) {
  return String(value || 'featured').replace(/(^\w|\s\w)/g, match => match.toUpperCase());
}

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return String(params.get(name) || '').trim();
}

function getNumericId() {
  const raw = getQueryParam('id') || getQueryParam('product');
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getRequestedSlug() {
  return getQueryParam('slug').toLowerCase();
}

async function resolveProductFromRequest() {
  const productId = getNumericId();
  if (productId) {
    return getProductContentById(productId);
  }

  const slug = getRequestedSlug();
  if (!slug) {
    return null;
  }

  const catalog = await getCatalog();
  return catalog.find((entry) => {
    const entrySlug = String(entry?.slug || entry?.metadata?.slug || '').trim().toLowerCase();
    return entrySlug && entrySlug === slug;
  }) || null;
}

function resolveAssetPath(path) {
  return normalizeStorefrontAssetUrl(path);
}

function normalizeGallery(mainImage, gallery) {
  return normalizeStorefrontAssetList([
    mainImage,
    ...(Array.isArray(gallery) ? gallery : [])
  ]);
}

function normalizeSpecEntries(specs) {
  if (!Array.isArray(specs)) {
    return [];
  }

  return specs
    .map(entry => {
      if (!Array.isArray(entry) || entry.length < 2) {
        return null;
      }

      const label = String(entry[0] || '').trim();
      const value = String(entry[1] || '').trim();
      if (!label || !value) {
        return null;
      }

      return [label, value];
    })
    .filter(Boolean);
}

function resolveSocialProof(product) {
  const ratingCandidates = [product?.rating, product?.averageRating, product?.ratingAverage];
  let rating = null;
  for (const candidate of ratingCandidates) {
    const parsed = Number(candidate);
    if (candidate != null && candidate !== '' && Number.isFinite(parsed) && parsed > 0) {
      rating = Math.min(5, Number(parsed.toFixed(1)));
      break;
    }
  }

  const reviewCandidates = [
    product?.reviewCount,
    product?.reviewsCount,
    Array.isArray(product?.reviews) ? product.reviews.length : null
  ];
  let reviewCount = 0;
  for (const candidate of reviewCandidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) {
      reviewCount = Math.round(parsed);
      break;
    }
  }

  const soldCandidates = [product?.sold, product?.soldCount, product?.unitsSold, product?.salesCount];
  let soldCount = 0;
  for (const candidate of soldCandidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) {
      soldCount = Math.round(parsed);
      break;
    }
  }

  return { rating, reviewCount, soldCount };
}

function computeStock(product) {
  const colorVariants = extractColorVariantsFromProduct(product);
  if (colorVariants.length) {
    return computeProductTotalStock(colorVariants, 0);
  }

  const configuredStock = Number(product?.stock);
  if (Number.isFinite(configuredStock) && configuredStock >= 0) {
    return configuredStock;
  }

  return 0;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) {
      return text;
    }
  }

  return '';
}

function resolveList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    return value.split(/\n+|•/).map((entry) => entry.trim()).filter(Boolean);
  }

  return [];
}

function resolveHighlights(product) {
  const candidates = [
    product?.highlights,
    product?.features,
    product?.keyFeatures,
    product?.metadata?.highlights,
    product?.metadata?.features
  ];

  for (const candidate of candidates) {
    const items = resolveList(candidate);
    if (items.length) {
      return items;
    }
  }

  return [];
}

function buildSpecs(product) {
  const stockCount = computeStock(product);
  const discount = getDiscount(product.price, product.oldPrice);
  const derivedSpecs = [
    ['Brand', firstText(product.brand, product.brandName, product.metadata?.brand)],
    ['Category', product.category ? titleCase(product.category) : ''],
    ['SKU', firstText(product.sku, product.skuCode, product.metadata?.sku)],
    ['Material', firstText(product.material, product.metadata?.material)],
    ['Color', firstText(product.color, product.colour, product.metadata?.color)],
    ['Weight', firstText(product.weight, product.metadata?.weight)],
    ['Origin', firstText(product.countryOfOrigin, product.origin, product.metadata?.origin)],
    ['Availability', Number.isFinite(stockCount) ? (stockCount > 0 ? `${stockCount} in stock` : 'Out of stock') : '']
  ];

  if (discount > 0) {
    derivedSpecs.push(['Discount', `${discount}% off`]);
  }

  const configuredSpecs = normalizeSpecEntries(product.specs);
  const usedLabels = new Set();
  const specs = [];

  for (const [label, value] of [...configuredSpecs, ...derivedSpecs]) {
    const key = String(label || '').toLowerCase();
    if (!key || !value || usedLabels.has(key)) {
      continue;
    }

    usedLabels.add(key);
    specs.push([label, value]);
  }

  return specs;
}

function pickOriginalProductImage(product) {
  const candidates = [
    product?.originalImage,
    isProductCardImageUrl(product?.mainImage) ? '' : product?.mainImage,
    isProductCardImageUrl(product?.image) ? '' : product?.image,
    ...(Array.isArray(product?.gallery) ? product.gallery : [])
  ];

  for (const candidate of candidates) {
    const normalized = normalizeStorefrontAssetUrl(candidate);
    if (!normalized || isProductCardImageUrl(normalized) || /^javascript:/i.test(normalized)) {
      continue;
    }

    const lowered = normalized.replace(/\\/g, '/').toLowerCase();
    if (/(?:^|\/)img\/logo\.png(?:\?|#|$)/.test(lowered) || lowered.endsWith('/img/logo.png')) {
      continue;
    }

    return normalized;
  }

  return '';
}

function usableCardImageUrl(value) {
  const normalized = normalizeStorefrontAssetUrl(value);
  return isProductCardImageUrl(normalized) ? normalized : '';
}

function mergeProductContent(product) {
  const mergedProduct = {
    ...product
  };
  const resolvedFallback = resolveProductImageUrl({
    ...mergedProduct,
    mainImage: mergedProduct.mainImage || mergedProduct.image || product.mainImage || product.image,
    image: mergedProduct.image || mergedProduct.mainImage || product.image || product.mainImage,
    thumbnail: mergedProduct.thumbnail || product.thumbnail,
    gallery: mergedProduct.gallery || product.gallery,
    mainImageStoragePath: mergedProduct.mainImageStoragePath || product.mainImageStoragePath || product.imageStoragePath,
    imageStoragePath: mergedProduct.imageStoragePath || product.imageStoragePath,
    galleryStoragePaths: mergedProduct.galleryStoragePaths || product.galleryStoragePaths
  });
  const mainImage = pickOriginalProductImage(mergedProduct) || resolvedFallback;
  const gallery = normalizeGallery(mainImage, mergedProduct.gallery || product.gallery).filter((entry) => !isProductCardImageUrl(entry));
  const uniqueGallery = gallery.length ? gallery : (mainImage ? [mainImage] : []);
  const providedCards = Array.isArray(mergedProduct.galleryCardImages) ? mergedProduct.galleryCardImages : [];
  const hasApiCardList = Array.isArray(mergedProduct.galleryCardImages);
  const galleryCardImages = uniqueGallery.map((entry, index) => {
    const provided = usableCardImageUrl(providedCards[index] || '');
    if (provided) {
      return provided;
    }

    if (index === 0) {
      const mainCard = usableCardImageUrl(mergedProduct.cardImage || '');
      if (mainCard) {
        return mainCard;
      }
    }

    if (!hasApiCardList) {
      return toProductCardImageUrl(entry) || '';
    }

    return '';
  });
  const display = resolveProductDisplayImage(mainImage, mergedProduct.cardImage || galleryCardImages[0] || '');
  const cardImage = display.preview;
  const price = Number(mergedProduct.price ?? product.price ?? product.salePrice ?? 0);
  const compareCandidates = [
    mergedProduct.oldPrice,
    product.oldPrice,
    mergedProduct.compareAtPrice,
    product.compareAtPrice,
    mergedProduct.originalPrice,
    product.originalPrice,
    mergedProduct.discountPrice,
    product.discountPrice
  ];
  let oldPrice = 0;
  for (const candidate of compareCandidates) {
    const parsed = Number(candidate) || 0;
    if (parsed > price) {
      oldPrice = parsed;
      break;
    }
  }

  return {
    ...mergedProduct,
    name: mergedProduct.name || product.name,
    category: mergedProduct.category || product.category,
    badge: mergedProduct.badge || product.badge,
    price,
    salePrice: price,
    oldPrice,
    originalPrice: oldPrice,
    compareAtPrice: oldPrice,
    discountPercent: Number(mergedProduct.discountPercent ?? product.discountPercent ?? 0) > 0
      ? Math.round(Number(mergedProduct.discountPercent ?? product.discountPercent))
      : (oldPrice > price ? Math.round(((oldPrice - price) / oldPrice) * 100) : 0),
    stock: Number(mergedProduct.stock ?? product.stock ?? 0),
    mainImage,
    originalImage: mainImage,
    cardImage,
    gallery: uniqueGallery,
    galleryCardImages,
    image: mainImage
  };
}

function buildAccordion(product, specs) {
  const sections = [];

  if (Array.isArray(specs) && specs.length) {
    sections.push({
      id: 'specifications',
      title: 'Specifications',
      open: true,
      type: 'specs',
      content: specs
    });
  }

  sections.push({
    id: 'delivery',
    title: 'Delivery and Support',
    open: false,
    type: 'list',
    content: [
      'Convenient delivery is available for orders placed through BYOSE Market.',
      'Checkout uses the existing cart and Buy Now flow.',
      'Customer support is available by phone, WhatsApp, and email.'
    ]
  });

  return sections;
}

function getDiscount(price, oldPrice) {
  const current = Number(price || 0);
  const previous = Number(oldPrice || 0);
  if (previous <= current || previous <= 0) {
    return 0;
  }

  return Math.round(((previous - current) / previous) * 100);
}

export function formatPrice(value) {
  return `RWF ${Number(value || 0).toLocaleString('en-US')}`;
}

export function createProductUrl(product, mode = 'relative') {
  const base = mode === 'root' ? 'details/product-details1.html' : 'details/product-details1.html';
  return `${base}?id=${encodeURIComponent(product.id)}`;
}

export async function loadProductData() {
  const product = await resolveProductFromRequest();

  if (!product) {
    return null;
  }

  const mergedProduct = mergeProductContent(product);
  const socialProof = resolveSocialProof(mergedProduct);
  const stockCount = computeStock(mergedProduct);
  const specs = buildSpecs(mergedProduct);
  const discount = Number(mergedProduct.discountPercent ?? product.discountPercent ?? 0) > 0
    ? Math.round(Number(mergedProduct.discountPercent ?? product.discountPercent))
    : getDiscount(mergedProduct.price, mergedProduct.oldPrice);
  const longDescription = (() => {
    const fromArray = splitDescriptionParagraphs(mergedProduct.longDescription);
    if (fromArray.length) {
      return fromArray;
    }

    return splitDescriptionParagraphs(
      mergedProduct.description
      || mergedProduct.metadata?.longDescription
      || mergedProduct.metadata?.description
    );
  })();
  const highlights = resolveHighlights(mergedProduct);
  const trust = Array.isArray(mergedProduct.trust) && mergedProduct.trust.length
    ? mergedProduct.trust.filter(Boolean)
    : [];

  return {
    ...mergedProduct,
    categoryLabel: firstText(mergedProduct.category) ? titleCase(mergedProduct.category) : '',
    badgeLabel: firstText(mergedProduct.badge, mergedProduct.badgeLabel, mergedProduct.metadata?.badge),
    rating: socialProof.rating,
    reviewCount: socialProof.reviewCount,
    soldCount: socialProof.soldCount,
    stockCount,
    stockLabel: stockCount > 0 ? `${stockCount} in stock` : 'Out of stock',
    discount,
    discountPercent: discount,
    shortDescription: firstText(mergedProduct.shortDescription, mergedProduct.description, mergedProduct.metadata?.description),
    metaTitle: mergedProduct.metaTitle || mergedProduct.metadata?.metaTitle || mergedProduct.name,
    metaDescription: mergedProduct.metaDescription || mergedProduct.metadata?.metaDescription || mergedProduct.shortDescription || mergedProduct.description,
    longDescription,
    highlights,
    trust,
    specs,
    accordion: buildAccordion(mergedProduct, specs)
  };
}

export async function getRelatedProducts(currentProduct, limit = 5) {
  const cached = getCachedProductContent();
  const catalog = cached.length ? cached : await getCatalog();
  const category = String(currentProduct?.category || '').toLowerCase();
  return catalog
    .filter(item => Number(item.id) !== Number(currentProduct.id))
    .sort((left, right) => {
      const leftScore = String(left.category || '').toLowerCase() === category ? 0 : 1;
      const rightScore = String(right.category || '').toLowerCase() === category ? 0 : 1;
      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }
      return Number(right.priority || 0) - Number(left.priority || 0);
    })
    .slice(0, limit)
    .map(item => {
      const mergedProduct = mergeProductContent(item);
      const pricing = buildDiscountedProductView(mergedProduct);

      return {
        ...mergedProduct,
        ...pricing,
        categoryLabel: titleCase(mergedProduct.category),
        href: createProductUrl(mergedProduct),
        priceLabel: formatPrice(pricing.price),
        oldPriceLabel: pricing.oldPrice > pricing.price ? formatPrice(pricing.oldPrice) : ''
      };
    });
}
