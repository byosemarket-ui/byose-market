/**
 * STEP 3H: Backend-Driven Homepage Rendering
 * STEP 3K: Enterprise Product Card System Integration
 * 
 * Homepage now fetches products from centralized backend API
 * and renders using unified professional product cards.
 */

import productService from './services/centralized-products.service.js';
import ProductCardSystem from './js/product-card-system.js';
import { normalizeStorefrontAssetUrl, resolveProductImageUrl } from './services/storefront-asset-url.js';
import {
  filterProductsForSection,
  getProductPlacements,
  normalizeDisplayPriority,
  normalizeVisibility,
  productHasPlacement,
  resolveHighlightTagFromPlacements,
  shouldShowOnSurface,
  sortProductsByDisplay
} from './js/storefront-display.js';
import { buildDiscountedProductView } from './js/storefront-discount.js';
import { summarizeCatalogPipeline, traceStorefrontStage } from './js/storefront-pipeline-trace.js';

const DEFAULT_FILTER = 'all';
const DEFAULT_CATEGORY = 'featured';
const DEFAULT_DETAIL_PAGE = 'details/product-details1.html';
const FALLBACK_IMAGE = 'img/logo.png';
const SPOTLIGHT_LIMIT = 6;
const SPOTLIGHT_START_OFFSET = 5;
const HERO_INTERVAL_MS = 3500;
const NEWSLETTER_STORAGE_KEY = 'byose_market_newsletter_subscribers';

const CATEGORY_ALIASES = {
  footwear: 'shoes',
  shoe: 'shoes',
  sneaker: 'shoes',
  sneakers: 'shoes'
};

const state = {
  catalog: [],
  filterCache: new Map(),
  markupCache: new Map(),
  currentFilter: DEFAULT_FILTER
};

const PLACEMENT_SECTION_LIMIT = 6;

const elements = {
  filterPills: document.getElementById('filterPills'),
  homeProducts: document.getElementById('homeProducts'),
  productGrid: document.getElementById('homeProductGrid'),
  spotlightGrid: document.getElementById('spotlightGrid'),
  featuredSection: document.getElementById('featuredSection'),
  featuredGrid: document.getElementById('featuredGrid'),
  bestSellersSection: document.getElementById('bestSellersSection'),
  bestSellersGrid: document.getElementById('bestSellersGrid'),
  flashDealsSection: document.getElementById('flashDealsSection'),
  flashDealsGrid: document.getElementById('flashDealsGrid')
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeHomePage, { once: true });
} else {
  initializeHomePage();
}

function initializeHomePage() {
  syncCatalog();
  setupFilterControls();
  setupHeroSlider();

  // Listen for backend product synchronization events
  window.addEventListener(productService.GLOBAL_SYNC_EVENT, syncCatalog);
  window.addEventListener('byose:hero-slides-updated', setupHeroSlider);
}

async function syncCatalog() {
  try {
    traceStorefrontStage("fetch-start", { surface: "home" });
    const products = await productService.getProductsWithRetry();
    traceStorefrontStage("fetch-complete", { surface: "home", count: products.length });

    const normalized = products.map(normalizeProduct);
    const visible = normalized.filter(product => shouldShowOnSurfaceLocal(product, 'home'));
    state.catalog = visible.sort(sortProductsByDisplayLocal);

    traceStorefrontStage("filter-complete", {
      surface: "home",
      fetchedCount: products.length,
      visibleCount: state.catalog.length,
      filteredOut: products.length - state.catalog.length
    });
    
    state.filterCache.clear();
    state.markupCache.clear();
    renderProductGrid(state.currentFilter);
    renderPlacementSections();
    renderSpotlightGrid();
  } catch (error) {
    console.error('[Homepage] Failed to sync products:', error);
    traceStorefrontStage("fetch-error", { surface: "home", message: String(error?.message || error) });
    // Attempt to use cached data as fallback
    const cached = productService.getCachedProducts();
    if (Array.isArray(cached) && cached.length > 0) {
      state.catalog = cached
        .map(normalizeProduct)
        .filter(product => shouldShowOnSurfaceLocal(product, 'home'))
        .sort(sortProductsByDisplayLocal);
      renderProductGrid(state.currentFilter);
      renderPlacementSections();
      renderSpotlightGrid();
    }
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeCategory(category) {
  const normalized = normalizeText(category);
  if (!normalized) {
    return DEFAULT_CATEGORY;
  }

  return CATEGORY_ALIASES[normalized] || normalized.replace(/\s+/g, '-');
}

function normalizeVisibilityLocal(value) {
  return normalizeVisibility(value);
}

function normalizePriority(value) {
  return normalizeDisplayPriority(value);
}

function normalizeHighlightTag(value) {
  const normalized = normalizeText(value).replace(/\s+/g, '-');
  if (normalized === 'featured' || normalized === 'trending' || normalized === 'new') {
    return normalized;
  }

  return '';
}

function getHighlightTagLabel(value) {
  if (value === 'featured') {
    return 'Featured';
  }
  if (value === 'trending') {
    return 'Trending';
  }
  if (value === 'new') {
    return 'New';
  }
  return '';
}

function formatCategoryLabel(category) {
  return String(category || DEFAULT_CATEGORY)
    .replace(/-/g, ' ')
    .replace(/(^\w|\s\w)/g, match => match.toUpperCase());
}

function currency(value) {
  return `RWF ${Number(value || 0).toLocaleString('en-US')}`;
}

function isSafePath(value) {
  const path = String(value || '').trim();
  return Boolean(path) && !/^javascript:/i.test(path);
}

function getProductHref(productId) {
  return `${DEFAULT_DETAIL_PAGE}?id=${encodeURIComponent(String(productId))}`;
}

function normalizeProduct(product, index) {
  const fallbackId = index + 1;
  const id = product && product.id ? product.id : fallbackId;
  const name = String(product && product.name ? product.name : '').trim() || `Product ${fallbackId}`;
  const shortName = String(
    product?.shortName
    || product?.metadata?.shortName
    || product?.title
    || ''
  ).trim();
  const cardName = shortName || name;
  const category = normalizeCategory(product && product.category);
  const badge = String(product && product.badge ? product.badge : '').trim();
  const visibility = normalizeVisibilityLocal(product && product.visibility);
  const priority = normalizePriority(product?.priority ?? product?.metadata?.priorityScore);
  const orderIndex = Math.max(0, Number(product && (product.orderIndex ?? product.order_index)) || 0);
  const placements = getProductPlacements(product);
  const highlightTag = normalizeHighlightTag(product && product.highlightTag)
    || resolveHighlightTagFromPlacements(placements);
  const shortDescription = String(product && product.shortDescription ? product.shortDescription : '').trim();
  const productImage = resolveProductImageUrl(product);
  const image = productImage || normalizeStorefrontAssetUrl(FALLBACK_IMAGE);
  const price = Number(product && (product.price ?? product.salePrice)) || 0;
  const pricing = buildDiscountedProductView({
    ...product,
    price
  });
  const oldPrice = pricing.oldPrice;
  const searchText = normalizeText([
    name,
    category,
    badge,
    shortDescription,
    ...(Array.isArray(product && product.highlights) ? product.highlights : []),
    ...(Array.isArray(product && product.trust) ? product.trust : [])
  ].join(' '));

  return {
    ...product,
    id,
    name,
    cardName,
    shortName,
    badge,
    category,
    visibility,
    priority,
    orderIndex,
    placements,
    highlightTag,
    shortDescription,
    defaultIndex: index,
    mainImage: image,
    image,
    oldPrice,
    price: pricing.price,
    salePrice: pricing.price,
    originalPrice: pricing.originalPrice,
    compareAtPrice: pricing.compareAtPrice,
    discountPercent: pricing.discountPercent,
    href: getProductHref(id),
    searchText
  };
}

function shouldShowOnSurfaceLocal(product, surface) {
  return shouldShowOnSurface(product, surface);
}

function sortProductsByDisplayLocal(left, right) {
  return sortProductsByDisplay(left, right);
}

function createProductCard(product) {
  return ProductCardSystem.renderCard(product);
}

function bindGridImageFallback(grid) {
  ProductCardSystem.bindCards(grid);
}

function applyStorefrontGridClasses(grid) {
  if (!grid) {
    return;
  }

  grid.classList.add('byose-product-grid', 'byose-product-grid--storefront');
  grid.classList.toggle('byose-product-grid--spotlight', grid.id === 'spotlightGrid');
}

function renderGrid(grid, cacheKey, items) {
  if (!grid) {
    return;
  }

  applyStorefrontGridClasses(grid);

  // Use unified product card system's grid rendering
  if (items.length === 0) {
    grid.innerHTML = `
      <div class="byose-product-grid-empty">
        <div class="byose-product-grid-empty-icon">📭</div>
        <p class="byose-product-grid-empty-text">No products available at this time.</p>
      </div>
    `;
    return;
  }

  const markup = state.markupCache.get(cacheKey) || items.map(createProductCard).join('');
  state.markupCache.set(cacheKey, markup);

  if (grid.dataset.renderKey === cacheKey && grid.dataset.renderMarkup === markup) {
    return;
  }

  grid.setAttribute('aria-busy', 'true');
  grid.innerHTML = markup;
  bindGridImageFallback(grid);
  grid.dataset.renderKey = cacheKey;
  grid.dataset.renderMarkup = markup;
  grid.removeAttribute('aria-busy');
}

function getProductsForFilter(filter) {
  const requestedFilter = String(filter || DEFAULT_FILTER).trim() || DEFAULT_FILTER;
  const normalizedFilter = requestedFilter === DEFAULT_FILTER ? DEFAULT_FILTER : normalizeText(requestedFilter).replace(/\s+/g, '-');
  const cacheKey = `filter:${normalizedFilter}`;

  if (state.filterCache.has(cacheKey)) {
    return state.filterCache.get(cacheKey);
  }

  let items = [];

  if (normalizedFilter === DEFAULT_FILTER) {
    items = state.catalog.slice();
  } else {
    items = state.catalog.filter(product => matchesFilter(product, normalizedFilter));
  }

  state.filterCache.set(cacheKey, items);
  return items;
}

function matchesFilter(product, normalizedFilter) {
  if (!product) {
    return false;
  }

  return product.category === normalizeCategory(normalizedFilter);
}

function setActiveFilter(filter) {
  state.currentFilter = String(filter || DEFAULT_FILTER).trim() || DEFAULT_FILTER;
  document.querySelectorAll('.home-category-pill').forEach(pill => {
    const isActive = (pill.dataset.filter || DEFAULT_FILTER) === state.currentFilter;
    pill.classList.toggle('is-active', isActive);
    pill.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  renderProductGrid(state.currentFilter);
}

function renderProductGrid(filter) {
  const items = getProductsForFilter(filter);
  summarizeCatalogPipeline({
    source: "homepage-grid",
    fetched: state.catalog,
    visible: items,
    rendered: items.length,
    surface: "home",
    gridId: elements.productGrid?.id || "homeProductGrid"
  });
  renderGrid(elements.productGrid, `home:${filter}`, items);
}

function renderPlacementSection(sectionEl, gridEl, cacheKey, placement, limit = PLACEMENT_SECTION_LIMIT) {
  if (!gridEl) {
    return;
  }

  const items = filterProductsForSection(state.catalog, placement, 'home').slice(0, limit);
  if (sectionEl) {
    sectionEl.hidden = items.length === 0;
  }

  if (!items.length) {
    gridEl.innerHTML = '';
    return;
  }

  renderGrid(gridEl, cacheKey, items);
}

function renderPlacementSections() {
  renderPlacementSection(elements.featuredSection, elements.featuredGrid, 'featured', 'featured_products');
  renderPlacementSection(elements.bestSellersSection, elements.bestSellersGrid, 'best-sellers', 'best_sellers');
  renderPlacementSection(elements.flashDealsSection, elements.flashDealsGrid, 'flash-deals', 'flash_deals');
}

function getSpotlightProducts() {
  const curated = filterProductsForSection(state.catalog, 'fresh_picks', 'home');
  const newArrivals = filterProductsForSection(state.catalog, 'new_arrivals', 'home');
  const combined = [...curated];
  newArrivals.forEach((product) => {
    if (!combined.some((entry) => Number(entry.id) === Number(product.id))) {
      combined.push(product);
    }
  });

  if (combined.length) {
    return combined.slice(0, SPOTLIGHT_LIMIT);
  }

  const spotlightSource = state.catalog;
  const startIndex = Math.min(SPOTLIGHT_START_OFFSET, Math.max(0, spotlightSource.length - SPOTLIGHT_LIMIT));
  return spotlightSource.slice(startIndex, startIndex + SPOTLIGHT_LIMIT);
}

function renderSpotlightGrid() {
  renderGrid(elements.spotlightGrid, 'spotlight', getSpotlightProducts());
}

function setupFilterControls() {
  if (elements.filterPills) {
    elements.filterPills.addEventListener('click', event => {
      const pill = event.target.closest('.home-category-pill');
      if (!pill) {
        return;
      }

      setActiveFilter(pill.dataset.filter || DEFAULT_FILTER);
    });
  }
}

function setupHeroSlider() {
  if (typeof window.__byoseHeroSliderCleanup === 'function') {
    window.__byoseHeroSliderCleanup();
    window.__byoseHeroSliderCleanup = null;
  }

  const slides = Array.from(document.querySelectorAll('.hero-slide'));
  const dotsRoot = document.getElementById('heroDots');
  const nextBtn = document.getElementById('nextBtn');
  const prevBtn = document.getElementById('prevBtn');
  const hero = document.getElementById('heroSection');
  const controls = hero ? hero.querySelector('.hero-controls') : null;

  if (!slides.length || !dotsRoot || !hero) {
    if (dotsRoot) {
      dotsRoot.innerHTML = '';
    }
    return;
  }

  let index = 0;
  let timerId = 0;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canRotate = slides.length > 1;

  if (controls) {
    controls.hidden = !canRotate;
  }

  dotsRoot.innerHTML = slides.map((_, dotIndex) => `
    <button type="button" class="hero-dot${dotIndex === 0 ? ' is-active' : ''}" data-dot-index="${dotIndex}" aria-label="Show slide ${dotIndex + 1}: ${escapeHtml(slides[dotIndex].querySelector('h1')?.textContent || 'Hero slide')}"></button>
  `).join('');

  const dots = Array.from(dotsRoot.querySelectorAll('.hero-dot'));

  function show(nextIndex) {
    index = (nextIndex + slides.length) % slides.length;
    slides.forEach((slide, slideIndex) => {
      slide.classList.toggle('active', slideIndex === index);
      slide.setAttribute('aria-hidden', slideIndex === index ? 'false' : 'true');
    });
    dots.forEach((dot, dotIndex) => {
      dot.classList.toggle('is-active', dotIndex === index);
    });
  }

  function stop() {
    if (timerId) {
      window.clearInterval(timerId);
      timerId = 0;
    }
  }

  function start() {
    if (prefersReducedMotion || !canRotate || document.hidden) {
      return;
    }

    stop();
    timerId = window.setInterval(() => {
      show(index + 1);
    }, HERO_INTERVAL_MS);
  }

  const handleDotsClick = event => {
    const dot = event.target.closest('.hero-dot');
    if (!dot) {
      return;
    }

    show(Number(dot.dataset.dotIndex || 0));
    start();
  };

  dotsRoot.addEventListener('click', handleDotsClick);

  const handleNextClick = () => {
    show(index + 1);
    start();
  };
  if (nextBtn) {
    nextBtn.addEventListener('click', handleNextClick);
  }

  const handlePrevClick = () => {
    show(index - 1);
    start();
  };
  if (prevBtn) {
    prevBtn.addEventListener('click', handlePrevClick);
  }

  const handleMouseEnter = () => stop();
  const handleMouseLeave = () => start();
  const handleTouchStart = () => stop();
  const handleTouchEnd = () => start();
  const handleVisibilityChange = () => {
    if (document.hidden) {
      stop();
      return;
    }
    start();
  };

  hero.addEventListener('mouseenter', handleMouseEnter);
  hero.addEventListener('mouseleave', handleMouseLeave);
  hero.addEventListener('touchstart', handleTouchStart, { passive: true });
  hero.addEventListener('touchend', handleTouchEnd, { passive: true });
  document.addEventListener('visibilitychange', handleVisibilityChange);

  window.__byoseHeroSliderCleanup = () => {
    stop();
    dotsRoot.removeEventListener('click', handleDotsClick);
    if (nextBtn) {
      nextBtn.removeEventListener('click', handleNextClick);
    }
    if (prevBtn) {
      prevBtn.removeEventListener('click', handlePrevClick);
    }
    hero.removeEventListener('mouseenter', handleMouseEnter);
    hero.removeEventListener('mouseleave', handleMouseLeave);
    hero.removeEventListener('touchstart', handleTouchStart);
    hero.removeEventListener('touchend', handleTouchEnd);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };

  show(0);
  start();
}

function setupFooterSubscribe() {
  const form = document.getElementById('footerSubscribeForm');
  const input = document.getElementById('footerEmail');
  const note = document.getElementById('footerNote');

  if (!form || !input || !note) {
    return;
  }

  form.addEventListener('submit', event => {
    event.preventDefault();

    const email = input.value.trim().toLowerCase();
    if (!email || !input.checkValidity()) {
      note.textContent = 'Andika email iboneye.';
      note.classList.remove('is-success');
      return;
    }

    try {
      const current = new Set(JSON.parse(localStorage.getItem(NEWSLETTER_STORAGE_KEY) || '[]'));
      current.add(email);
      localStorage.setItem(NEWSLETTER_STORAGE_KEY, JSON.stringify(Array.from(current)));
      note.textContent = 'Murakoze. Twakwanditse ku rutonde rwacu.';
      note.classList.add('is-success');
      form.reset();
    } catch (error) {
      note.textContent = 'Ntibyabashije kubika email yawe. Ongera ugerageze.';
      note.classList.remove('is-success');
    }
  });
}