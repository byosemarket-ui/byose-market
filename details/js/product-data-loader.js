import { getAllProductContent } from './product-content.js';

const CATEGORY_COPY = {
  shoes: {
    label: 'Shoes',
    badge: 'Top Pick',
    description: 'Built for everyday movement with a light upper, supportive base, and a cleaner finish that works from weekday errands to weekend outings.',
    longDescription: [
      'This product is selected for shoppers who want comfort, durability, and a modern silhouette without paying luxury pricing. The profile is easy to style, the material mix is practical for daily wear, and the fit is tuned for repeat use.',
      'The overall build keeps the look streamlined while still focusing on everyday performance. You get an item that feels current, photographs well, and stays useful across multiple situations instead of serving only one outfit or occasion.'
    ],
    highlights: ['Comfort-focused daily wear', 'Balanced grip and lightweight build', 'Easy to pair with casual outfits'],
    specs: [
      ['Material', 'Breathable mixed upper'],
      ['Use case', 'Daily wear'],
      ['Closure', 'Secure standard fit'],
      ['Finish', 'Easy-clean surface']
    ],
    trust: ['Fast delivery in Kigali', 'Easy exchange support', 'Verified catalog item']
  },
  electronics: {
    label: 'Electronics',
    badge: 'Smart Choice',
    description: 'A reliable electronics pick with practical performance, clear value, and a design that fits naturally into modern daily use.',
    longDescription: [
      'This item focuses on the basics that matter most: dependable operation, straightforward setup, and a polished presentation that feels more premium than its price point suggests.',
      'It is a strong fit for customers who want functional tech without unnecessary complexity. The product is selected to stay relevant for routine use and gifting alike.'
    ],
    highlights: ['Good value for the category', 'Practical features for daily use', 'Clean presentation with modern styling'],
    specs: [
      ['Category', 'Consumer electronics'],
      ['Setup', 'Ready for daily use'],
      ['Power', 'Standard efficient usage'],
      ['Packaging', 'Protected retail packaging']
    ],
    trust: ['Secure checkout support', 'Catalog-tested selection', 'Quick after-sale help']
  },
  fashion: {
    label: 'Fashion',
    badge: 'Trending',
    description: 'A polished fashion piece chosen for a strong visual finish, practical wearability, and an easy fit into everyday style rotation.',
    longDescription: [
      'This product is designed to help shoppers build a cleaner look with less effort. The styling is intentional, the presentation feels current, and the overall piece is flexible enough for both regular wear and occasion dressing.',
      'Instead of chasing short-term novelty, the selection prioritizes repeat wear, easy matching, and a finish that looks good both in person and in photos.'
    ],
    highlights: ['Modern styling', 'Comfortable everyday use', 'Works with multiple outfit types'],
    specs: [
      ['Style', 'Modern everyday fashion'],
      ['Care', 'Simple maintenance'],
      ['Finish', 'Clean visual detailing'],
      ['Fit', 'Versatile regular fit']
    ],
    trust: ['Curated seasonal selection', 'Responsive customer support', 'Easy order tracking']
  },
  default: {
    label: 'Featured',
    badge: 'Featured',
    description: 'A practical catalog item selected for value, clean design, and dependable everyday use.',
    longDescription: [
      'This product balances presentation, usefulness, and price in a way that makes it easy to recommend for a wide range of shoppers.',
      'It is intended to feel current, straightforward, and dependable rather than overly complicated.'
    ],
    highlights: ['Strong overall value', 'Modern catalog presentation', 'Ready for daily use'],
    specs: [
      ['Category', 'General merchandise'],
      ['Availability', 'In active catalog'],
      ['Support', 'Standard customer support'],
      ['Delivery', 'Fast local handling']
    ],
    trust: ['Reliable shopping experience', 'Easy checkout flow', 'Customer-friendly support']
  }
};

async function getCatalog() {
  const detailCatalog = await getAllProductContent();
  return Array.isArray(detailCatalog) ? detailCatalog : [];
}

function getCategoryProfile(category) {
  return CATEGORY_COPY[String(category || '').toLowerCase()] || CATEGORY_COPY.default;
}

function titleCase(value) {
  return String(value || 'featured').replace(/(^\w|\s\w)/g, match => match.toUpperCase());
}

function getNumericId() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('id') || params.get('product');
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function resolveAssetPath(path) {
  const value = String(path || '').trim();

  if (!value || /^(?:[a-z]+:|\/|\.\.\/|\.\/)/i.test(value)) {
    return value;
  }

  return `../${value}`;
}

function normalizeGallery(mainImage, gallery) {
  return Array.from(new Set([
    mainImage,
    ...(Array.isArray(gallery) ? gallery : [])
  ].filter(Boolean).map(resolveAssetPath)));
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

function computeRating(product) {
  const base = 4.2 + ((Number(product.id) * 7) % 7) * 0.1;
  return Math.min(4.9, Number(base.toFixed(1)));
}

function computeReviewCount(product) {
  return 26 + Number(product.id || 0) * 11;
}

function computeStock(product) {
  const configuredStock = Number(product?.stock);
  if (Number.isFinite(configuredStock) && configuredStock >= 0) {
    return configuredStock;
  }

  return 8 + (Number(product.id || 0) * 3) % 17;
}

function buildSpecs(product, profile) {
  const discount = getDiscount(product.price, product.oldPrice);
  const derivedSpecs = [
    ['SKU', `BM-${String(product.id).padStart(4, '0')}`],
    ['Category', profile.label],
    ['Availability', `${computeStock(product)} units ready`],
    ['Discount', discount > 0 ? `${discount}% off` : 'Best value pricing']
  ];

  const configuredSpecs = normalizeSpecEntries(profile.specs);
  const usedLabels = new Set(configuredSpecs.map(([label]) => String(label).toLowerCase()));
  const supplementalSpecs = derivedSpecs.filter(([label]) => !usedLabels.has(String(label).toLowerCase()));

  return [...configuredSpecs, ...supplementalSpecs].slice(0, 8);
}

function mergeProductContent(product) {
  const mergedProduct = {
    ...product
  };
  const mainImage = resolveAssetPath(mergedProduct.mainImage || mergedProduct.image || product.mainImage || product.image);
  const gallery = normalizeGallery(mainImage, mergedProduct.gallery || product.gallery);

  return {
    ...mergedProduct,
    name: mergedProduct.name || product.name,
    category: mergedProduct.category || product.category,
    badge: mergedProduct.badge || product.badge,
    price: Number(mergedProduct.price ?? product.price ?? 0),
    oldPrice: Number(mergedProduct.oldPrice ?? product.oldPrice ?? 0),
    stock: Number(mergedProduct.stock ?? product.stock ?? 0),
    mainImage,
    gallery,
    image: mainImage
  };
}

function buildAccordion(product, profile, specs) {
  return [
    {
      id: 'description',
      title: 'Full Description',
      open: true,
      type: 'paragraphs',
      content: profile.longDescription
    },
    {
      id: 'specifications',
      title: 'Specifications',
      open: false,
      type: 'specs',
      content: specs
    },
    {
      id: 'delivery',
      title: 'Delivery and Support',
      open: false,
      type: 'list',
      content: [
        'Fast order handling for customers in Kigali and surrounding areas.',
        'Support team available for product questions and order follow-up.',
        'Simple checkout flow with cart and buy-now support built into the page.'
      ]
    }
  ];
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
  const base = mode === 'root' ? 'details/product-details1.html' : 'product-details1.html';
  return `${base}?id=${encodeURIComponent(product.id)}`;
}

export async function loadProductData() {
  const catalog = await getCatalog();
  const productId = getNumericId();
  const product = catalog.find(item => Number(item.id) === productId) || null;

  if (!product) {
    return null;
  }

  const mergedProduct = mergeProductContent(product);
  const profile = getCategoryProfile(mergedProduct.category);
  const rating = computeRating(mergedProduct);
  const reviewCount = computeReviewCount(mergedProduct);
  const stockCount = computeStock(mergedProduct);
  const baseSpecs = Array.isArray(mergedProduct.specs) && mergedProduct.specs.length
    ? mergedProduct.specs
    : profile.specs;
  const specs = buildSpecs({ ...mergedProduct, price: mergedProduct.price, oldPrice: mergedProduct.oldPrice }, { ...profile, specs: baseSpecs });
  const discount = getDiscount(mergedProduct.price, mergedProduct.oldPrice);
  const longDescription = Array.isArray(mergedProduct.longDescription) && mergedProduct.longDescription.length
    ? mergedProduct.longDescription
    : profile.longDescription;
  const highlights = Array.isArray(mergedProduct.highlights) && mergedProduct.highlights.length
    ? mergedProduct.highlights
    : profile.highlights;
  const trust = Array.isArray(mergedProduct.trust) && mergedProduct.trust.length
    ? mergedProduct.trust
    : profile.trust;

  return {
    ...mergedProduct,
    categoryLabel: profile.label || titleCase(mergedProduct.category),
    badgeLabel: mergedProduct.badge || profile.badge,
    rating,
    reviewCount,
    stockCount,
    stockLabel: stockCount > 0 ? `${stockCount} in stock` : 'Limited stock',
    discount,
    shortDescription: mergedProduct.shortDescription || mergedProduct.description || profile.description,
    longDescription,
    highlights,
    trust,
    specs,
    accordion: buildAccordion(mergedProduct, { ...profile, longDescription }, specs)
  };
}

export async function getRelatedProducts(currentProduct, limit = 5) {
  const catalog = await getCatalog();
  return catalog
    .filter(item => Number(item.id) !== Number(currentProduct.id))
    .sort((left, right) => {
      const leftScore = String(left.category || '').toLowerCase() === String(currentProduct.category || '').toLowerCase() ? 0 : 1;
      const rightScore = String(right.category || '').toLowerCase() === String(currentProduct.category || '').toLowerCase() ? 0 : 1;
      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }
      return Number(left.id || 0) - Number(right.id || 0);
    })
    .slice(0, limit)
    .map(item => {
      const mergedProduct = mergeProductContent(item);

      return {
        ...mergedProduct,
        categoryLabel: titleCase(mergedProduct.category),
        href: createProductUrl(mergedProduct),
        priceLabel: formatPrice(mergedProduct.price),
        oldPriceLabel: Number(mergedProduct.oldPrice) > Number(mergedProduct.price) ? formatPrice(mergedProduct.oldPrice) : ''
      };
    });
}
