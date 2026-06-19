/**
 * STEP 3H: Backend-Driven Homepage Rendering
 * STEP 3K: Enterprise Product Card System Integration
 * 
 * Homepage now fetches products from centralized backend API
 * and renders using unified professional product cards.
 */

import productService from './services/centralized-products.service.js';
import ProductCardSystem from './js/product-card-system.js';
import { initHomeCategorySlider } from './js/home-category-slider.js';
import { normalizeStorefrontAssetUrl, resolveProductImageUrl } from './services/storefront-asset-url.js';

const DEFAULT_FILTER = 'all';
const DEFAULT_CATEGORY = 'featured';
const DEFAULT_DETAIL_PAGE = 'details/product-details1.html';
const FALLBACK_IMAGE = 'img/logo.png';
const PRIMARY_GRID_LIMIT = 10;
const SPOTLIGHT_LIMIT = 6;
const SPOTLIGHT_START_OFFSET = 5;
const HERO_INTERVAL_MS = 3500;
const NEWSLETTER_STORAGE_KEY = 'byose_market_newsletter_subscribers';

const CATEGORY_ALIASES = {
  apparel: 'fashion',
  bag: 'fashion',
  bags: 'fashion',
  clothes: 'fashion',
  clothing: 'fashion',
  footwear: 'shoes',
  phone: 'electronics',
  phones: 'electronics',
  shoe: 'shoes',
  sneakers: 'shoes',
  smartwatch: 'electronics',
  smartwatches: 'electronics',
  watch: 'electronics',
  watches: 'electronics'
};

const FILTER_KEYWORDS = {
  bags: ['bag', 'bags', 'ibikapu', 'sac'],
  watches: ['watch', 'smart watch', 'smartwatch', 'amasaha', 'montre'],
  phones: ['phone', 'phones', 'smartphone', 'mobile', 'iphone']
};

const state = {
  catalog: [],
  filterCache: new Map(),
  markupCache: new Map(),
  currentFilter: DEFAULT_FILTER
};

const elements = {
  categoryGrid: document.getElementById('categoryGrid'),
  filterPills: document.getElementById('filterPills'),
  homeProducts: document.getElementById('homeProducts'),
  productGrid: document.getElementById('homeProductGrid'),
  spotlightGrid: document.getElementById('spotlightGrid')
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
  initHomeCategorySlider();

  // Listen for backend product synchronization events
  window.addEventListener(productService.GLOBAL_SYNC_EVENT, syncCatalog);
  window.addEventListener('byose:hero-slides-updated', setupHeroSlider);
}

async function syncCatalog() {
  try {
    // Fetch products from backend (canonical source)
    const products = await productService.getProductsWithRetry();
    
    state.catalog = products
      .map(normalizeProduct)
      .filter(product => shouldShowOnSurface(product, 'home'))
      .sort(sortProductsByDisplay);
    
    state.filterCache.clear();
    state.markupCache.clear();
    renderProductGrid(state.currentFilter);
    renderSpotlightGrid();
  } catch (error) {
    console.error('[Homepage] Failed to sync products:', error);
    // Attempt to use cached data as fallback
    const cached = productService.getCachedProducts();
    if (Array.isArray(cached) && cached.length > 0) {
      state.catalog = cached
        .map(normalizeProduct)
        .filter(product => shouldShowOnSurface(product, 'home'))
        .sort(sortProductsByDisplay);
      renderProductGrid(state.currentFilter);
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

function normalizeVisibility(value) {
  const normalized = normalizeText(value).replace(/\s+/g, '-');
  if (normalized === 'home' || normalized === 'shop' || normalized === 'both') {
    return normalized;
  }

  if (normalized === 'home-only') {
    return 'home';
  }

  if (normalized === 'shop-only') {
    return 'shop';
  }

  return 'both';
}

function normalizePriority(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = Math.floor(value);
    return normalized === 2 ? 2 : normalized === 1 ? 1 : 0;
  }

  const normalizedText = normalizeText(value);
  if (!normalizedText || normalizedText === 'normal') {
    return 0;
  }

  if (normalizedText === 'top') {
    return 1;
  }

  if (normalizedText === 'featured') {
    return 2;
  }

  const parsed = Number(normalizedText);
  if (Number.isFinite(parsed)) {
    const normalized = Math.floor(parsed);
    return normalized === 2 ? 2 : normalized === 1 ? 1 : 0;
  }

  return 0;
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
  const category = normalizeCategory(product && product.category);
  const badge = String(product && product.badge ? product.badge : '').trim();
  const visibility = normalizeVisibility(product && product.visibility);
  const priority = normalizePriority(product && product.priority);
  const orderIndex = Math.max(0, Number(product && product.orderIndex) || 0);
  const highlightTag = normalizeHighlightTag(product && product.highlightTag);
  const shortDescription = String(product && product.shortDescription ? product.shortDescription : '').trim();
  const productImage = resolveProductImageUrl(product);
  const image = productImage || normalizeStorefrontAssetUrl(FALLBACK_IMAGE);
  const price = Number(product && (product.price ?? product.salePrice)) || 0;
  const compareCandidates = [
    product?.oldPrice,
    product?.compareAtPrice,
    product?.originalPrice,
    product?.discountPrice
  ];
  let oldPrice = 0;
  for (const candidate of compareCandidates) {
    const parsed = Number(candidate) || 0;
    if (parsed > price) {
      oldPrice = parsed;
      break;
    }
  }
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
    badge,
    category,
    visibility,
    priority,
    orderIndex,
    highlightTag,
    shortDescription,
    defaultIndex: index,
    mainImage: image,
    image,
    oldPrice: oldPrice > price ? oldPrice : 0,
    price,
    href: getProductHref(id),
    searchText
  };
}

function shouldShowOnSurface(product, surface) {
  const visibility = normalizeVisibility(product && product.visibility);
  return visibility === 'both' || visibility === surface;
}

function sortProductsByDisplay(left, right) {
  const leftPriority = normalizePriority(left && left.priority);
  const rightPriority = normalizePriority(right && right.priority);

  if (leftPriority !== rightPriority) {
    return rightPriority - leftPriority;
  }

  const leftOrder = Math.max(0, Number(left && left.orderIndex) || 0);
  const rightOrder = Math.max(0, Number(right && right.orderIndex) || 0);
  if (leftOrder !== rightOrder) {
    return rightOrder - leftOrder;
  }

  return Math.max(0, Number(left && left.defaultIndex) || 0) - Math.max(0, Number(right && right.defaultIndex) || 0);
}

function createProductCard(product) {
  return ProductCardSystem.renderCard(product);
}

function bindGridImageFallback(grid) {
  // Use unified product card system's image fallback handling
  ProductCardSystem.bindImageFallback(grid);
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

  bindGridImageFallback(grid);
  grid.setAttribute('aria-busy', 'true');
  grid.innerHTML = markup;
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

    if (!items.length) {
      const aliasedCategory = CATEGORY_ALIASES[normalizedFilter];
      if (aliasedCategory) {
        items = state.catalog.filter(product => product.category === aliasedCategory);
      }
    }
  }

  state.filterCache.set(cacheKey, items);
  return items;
}

function matchesFilter(product, normalizedFilter) {
  if (!product) {
    return false;
  }

  if (product.category === normalizedFilter) {
    return true;
  }

  const filterKeywords = FILTER_KEYWORDS[normalizedFilter];
  return Array.isArray(filterKeywords)
    ? filterKeywords.some(keyword => product.searchText.includes(normalizeText(keyword)))
    : false;
}

function setActiveFilter(filter) {
  state.currentFilter = String(filter || DEFAULT_FILTER).trim() || DEFAULT_FILTER;
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.classList.toggle('is-active', (pill.dataset.filter || DEFAULT_FILTER) === state.currentFilter);
  });
  renderProductGrid(state.currentFilter);
}

function renderProductGrid(filter) {
  const items = getProductsForFilter(filter).slice(0, PRIMARY_GRID_LIMIT);
  renderGrid(elements.productGrid, `home:${filter}`, items);
}

function getSpotlightProducts() {
  const spotlightSource = state.catalog.filter(product => ['electronics', 'fashion', 'shoes'].includes(product.category));
  const startIndex = Math.min(SPOTLIGHT_START_OFFSET, Math.max(0, spotlightSource.length - SPOTLIGHT_LIMIT));
  return spotlightSource.slice(startIndex, startIndex + SPOTLIGHT_LIMIT);
}

function renderSpotlightGrid() {
  renderGrid(elements.spotlightGrid, 'spotlight', getSpotlightProducts());
}

function setupFilterControls() {
  if (elements.filterPills) {
    elements.filterPills.addEventListener('click', event => {
      const pill = event.target.closest('.filter-pill');
      if (!pill) {
        return;
      }

      setActiveFilter(pill.dataset.filter || DEFAULT_FILTER);
    });
  }

  if (elements.categoryGrid) {
    elements.categoryGrid.addEventListener('click', event => {
      const card = event.target.closest('.category-card');
      if (!card) {
        return;
      }

      setActiveFilter(card.dataset.filter || DEFAULT_FILTER);
      scrollToProducts();
    });
  }
}

function scrollToProducts() {
  if (!elements.homeProducts) {
    return;
  }

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  elements.homeProducts.scrollIntoView({
    behavior: prefersReducedMotion ? 'auto' : 'smooth',
    block: 'start'
  });
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