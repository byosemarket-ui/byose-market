(function () {
  "use strict";

  /**
   * STEP 3H: Backend-Driven Shop Grid Rendering
   * STEP 3K: Enterprise Product Card System Integration
   * 
   * Shop page now fetches products from centralized backend API
   * and renders using unified professional product cards.
   */

  // Dynamic import of unified product card system
  let ProductCardSystem = null;
  const loadProductCardSystem = async () => {
    if (!ProductCardSystem) {
      ProductCardSystem = await import('./js/product-card-system.js').then(m => m.default);
    }
    return ProductCardSystem;
  };

  // Dynamic import of storefront display helpers
  const displayHelpersPromise = import("./js/storefront-display.js");
  const discountHelpersPromise = import("./js/storefront-discount.js");
  let displayHelpers = null;
  let discountHelpers = null;

  async function ensureDisplayHelpers() {
    if (!displayHelpers) {
      displayHelpers = await displayHelpersPromise;
    }
    return displayHelpers;
  }

  async function ensureDiscountHelpers() {
    if (!discountHelpers) {
      discountHelpers = await discountHelpersPromise;
    }
    return discountHelpers;
  }

  // Dynamic import of centralized product service
  const productService = (() => {
    let service = null;
    return async function getService() {
      if (!service) {
        service = await import('./services/centralized-products.service.js').then(m => m.default);
      }
      return service;
    };
  })();

  const DEFAULT_FILTER = "all";
  const DEFAULT_CATEGORY = "general";
  const DEFAULT_DETAIL_PAGE = "details/product-details1.html";
  const FALLBACK_IMAGE = "img/logo.png";
  const CATEGORY_ALIASES = {
    footwear: "shoes",
    shoe: "shoes",
    sneaker: "shoes",
    sneakers: "shoes"
  };

  const elements = {
    filterRoot: document.getElementById("shopFilters"),
    grid: document.getElementById("shopProductGrid"),
    resultsSummary: document.getElementById("resultsSummary")
  };

  const state = {
    currentFilter: getInitialFilter(),
    filteredCache: new Map(),
    markupCache: new Map(),
    products: []
  };

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatPrice(value) {
    return `RWF ${Number(value || 0).toLocaleString("en-US")}`;
  }

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function toPositiveNumber(value, fallbackValue) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
    return fallbackValue;
  }

  function normalizeCategory(category) {
    const normalized = normalizeText(category);
    if (!normalized) {
      return DEFAULT_CATEGORY;
    }

    return CATEGORY_ALIASES[normalized] || normalized.replace(/\s+/g, "-");
  }

  function normalizeShopFilter(filter) {
    return normalizeCategory(filter) === "shoes" ? "shoes" : DEFAULT_FILTER;
  }

  function normalizeVisibility(value) {
    const normalized = normalizeText(value).replace(/\s+/g, "-");
    if (normalized === "home" || normalized === "shop" || normalized === "both") {
      return normalized;
    }

    if (normalized === "home-only") {
      return "home";
    }

    if (normalized === "shop-only") {
      return "shop";
    }

    return "both";
  }

  function normalizeHighlightTag(value) {
    const normalized = normalizeText(value).replace(/\s+/g, "-");
    return normalized === "featured" || normalized === "trending" || normalized === "new"
      ? normalized
      : "";
  }

  function getHighlightTagLabel(value) {
    if (value === "featured") {
      return "Featured";
    }
    if (value === "trending") {
      return "Trending";
    }
    if (value === "new") {
      return "New";
    }
    return "";
  }

  function createCategoryLabel(category) {
    return String(category || DEFAULT_CATEGORY)
      .replace(/-/g, " ")
      .replace(/(^\w|\s\w)/g, match => match.toUpperCase());
  }

  function isSafeHref(value) {
    const href = String(value || "").trim();
    return Boolean(href) && !/^(?:javascript|data):/i.test(href);
  }

  function getProductHref(product) {
    const rawUrl = String(product && product.url ? product.url : "").trim();
    if (isSafeHref(rawUrl)) {
      return rawUrl;
    }

    const id = String(product && (product.id || product.catalogId) ? (product.id || product.catalogId) : "").trim();
    if (id) {
      return `${DEFAULT_DETAIL_PAGE}?id=${encodeURIComponent(id)}`;
    }

    const rawPage = String(product && product.page ? product.page : "").trim();
    if (isSafeHref(rawPage)) {
      return rawPage;
    }

    return DEFAULT_DETAIL_PAGE;
  }

  function normalizePriority(value, helpers) {
    if (helpers?.normalizeDisplayPriority) {
      return helpers.normalizeDisplayPriority(value);
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.floor(parsed))) : 50;
  }

  function normalizeProduct(product, index, helpers, discounts) {
    const fallbackId = `product-${index + 1}`;
    const id = String(product && (product.id || product.catalogId) ? (product.id || product.catalogId) : fallbackId).trim() || fallbackId;
    const price = toPositiveNumber(product && (product.price ?? product.salePrice), 0);
    const pricing = discounts?.buildDiscountedProductView
      ? discounts.buildDiscountedProductView({ ...product, price })
      : { price, oldPrice: 0, originalPrice: 0, compareAtPrice: 0, discountPercent: 0 };
    const oldPrice = pricing.oldPrice;
    const discountPercent = pricing.discountPercent;
    const name = String(product && product.name ? product.name : "").trim() || `Product ${id}`;
    const badge = String(product && product.badge ? product.badge : "").trim();
    const category = normalizeCategory(product && product.category);
    const image = String(product && (product.mainImage || product.image) ? (product.mainImage || product.image) : "").trim();
    const visibility = helpers?.normalizeVisibility
      ? helpers.normalizeVisibility(product && product.visibility)
      : normalizeVisibility(product && product.visibility);
    const priority = normalizePriority(product?.priority ?? product?.metadata?.priorityScore, helpers);
    const orderIndex = toPositiveNumber(product && (product.orderIndex ?? product.order_index), 0);
    const placements = helpers?.getProductPlacements ? helpers.getProductPlacements(product) : [];
    const highlightTag = normalizeHighlightTag(product && product.highlightTag)
      || (helpers?.resolveHighlightTagFromPlacements ? helpers.resolveHighlightTagFromPlacements(placements) : "");
    const keywords = Array.isArray(product && product.keywords)
      ? product.keywords.map(item => String(item || "").trim()).filter(Boolean)
      : [];
    const href = getProductHref({
      id,
      page: product && product.page,
      url: product && product.url
    });

    return {
      ...product,
      id,
      name,
      badge,
      category,
      visibility,
      priority,
      orderIndex,
      placements,
      highlightTag,
      defaultIndex: index,
      image,
      mainImage: image || String(product && (product.mainImage || product.image) ? (product.mainImage || product.image) : "").trim(),
      keywords,
      oldPrice,
      originalPrice: pricing.originalPrice,
      compareAtPrice: pricing.compareAtPrice,
      discountPercent,
      page: DEFAULT_DETAIL_PAGE,
      price: pricing.price,
      salePrice: pricing.price,
      href,
      url: href
    };
  }

  function shouldShowOnSurface(product, surface, helpers) {
    if (helpers?.shouldShowOnSurface) {
      return helpers.shouldShowOnSurface(product, surface);
    }
    const visibility = normalizeVisibility(product && product.visibility);
    return visibility === "both" || visibility === surface;
  }

  function sortProductsByDisplay(items, helpers) {
    if (helpers?.sortProductsByDisplay) {
      return items.slice().sort(helpers.sortProductsByDisplay);
    }
    return items.slice().sort((left, right) => {
      const leftOrder = toPositiveNumber(left && left.orderIndex, 0);
      const rightOrder = toPositiveNumber(right && right.orderIndex, 0);
      if (leftOrder !== rightOrder) {
        return rightOrder - leftOrder;
      }
      return normalizePriority(left?.priority, helpers) - normalizePriority(right?.priority, helpers);
    });
  }

  async function getCatalog(source) {
    const helpers = await ensureDisplayHelpers();
    const discounts = await ensureDiscountHelpers();
    const items = Array.isArray(source) ? source : [];
    return sortProductsByDisplay(
      items
        .map((product, index) => normalizeProduct(product, index, helpers, discounts))
        .filter(product => shouldShowOnSurface(product, "shop", helpers)),
      helpers
    );
  }

  async function buildProductCard(product) {
    const cardSystem = await loadProductCardSystem();
    return cardSystem.renderCard(product);
  }

  async function createProductGridMarkup(items, emptyMessage) {
    if (!Array.isArray(items) || !items.length) {
      return `
        <div class="byose-product-grid-empty">
          <div class="byose-product-grid-empty-icon">📭</div>
          <p class="byose-product-grid-empty-text">${escapeHtml(emptyMessage || "No products available right now.")}</p>
        </div>
      `;
    }

    // Build all cards asynchronously
    const cardsPromises = items.map(item => buildProductCard(item));
    const cardsHtml = await Promise.all(cardsPromises);
    return cardsHtml.join('');
  }

  function applyStorefrontGridClasses(targetGrid) {
    if (!targetGrid) {
      return;
    }

    targetGrid.classList.add('byose-product-grid', 'byose-product-grid--storefront', 'byose-product-grid--shop');
  }

  async function bindGridImageFallback(targetGrid) {
    if (!targetGrid || targetGrid.dataset.shopImageFallbackBound === "true") {
      return;
    }

    const cardSystem = await loadProductCardSystem();
    cardSystem.bindCards(targetGrid);
    targetGrid.dataset.shopImageFallbackBound = "true";
  }

  async function renderProductGrid(targetGrid, items, emptyMessage) {
    if (!targetGrid) {
      return;
    }

    applyStorefrontGridClasses(targetGrid);
    await bindGridImageFallback(targetGrid);
    targetGrid.setAttribute('aria-busy', 'true');
    const markup = await createProductGridMarkup(items, emptyMessage);
    targetGrid.innerHTML = markup;
    targetGrid.removeAttribute('aria-busy');
  }

  function updateResultsSummary(targetSummary, count, label) {
    if (!targetSummary) {
      return;
    }

    targetSummary.textContent = `${count} items${label ? ` • ${label}` : ""}`;
  }

  function filterProductsByCategory(items, category) {
    if (!Array.isArray(items)) {
      return [];
    }

    const normalizedCategory = normalizeCategory(category);
    if (!normalizedCategory || normalizedCategory === DEFAULT_FILTER || normalizedCategory === "all") {
      return items;
    }

    return items.filter(product => normalizeCategory(product && product.category) === normalizedCategory);
  }

  function getFilteredProducts(category) {
    const normalizedCategory = normalizeCategory(category);
    if (!normalizedCategory || normalizedCategory === DEFAULT_FILTER || normalizedCategory === "all") {
      return state.products;
    }

    if (!state.filteredCache.has(normalizedCategory)) {
      state.filteredCache.set(normalizedCategory, filterProductsByCategory(state.products, normalizedCategory));
    }

    return state.filteredCache.get(normalizedCategory) || [];
  }

  function getFilterLabel(button) {
    return String(button.dataset.label || button.textContent || "")
      .replace(/\s*✓\s*$/u, "")
      .trim();
  }

  function syncFilterButtons() {
    const buttons = Array.from(document.querySelectorAll(".shop-filters .shop-filter-pill"));
    buttons.forEach(button => {
      const buttonFilter = normalizeCategory(button.dataset.filter || DEFAULT_FILTER);
      const isActive = buttonFilter === state.currentFilter;
      const label = getFilterLabel(button);

      if (!button.dataset.label) {
        button.dataset.label = label;
      }

      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
      button.textContent = isActive ? `${label} ✓` : label;
    });
  }

  function syncUrlFilter() {
    if (typeof window.history.replaceState !== "function") {
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.delete("category");
    url.searchParams.delete("filter");
    if (state.currentFilter !== DEFAULT_FILTER) {
      url.searchParams.set("category", state.currentFilter);
    }

    window.history.replaceState({}, "", url);
  }

  async function renderShopPage() {
    if (!elements.grid) {
      return;
    }

    const filtered = getFilteredProducts(state.currentFilter);
    const label = !state.currentFilter || state.currentFilter === DEFAULT_FILTER || state.currentFilter === "all"
      ? "All items"
      : createCategoryLabel(state.currentFilter);

    if (!state.markupCache.has(state.currentFilter)) {
      const markup = await createProductGridMarkup(filtered, "No products available in this category right now.");
      state.markupCache.set(state.currentFilter, markup);
    }

    applyStorefrontGridClasses(elements.grid);
    await bindGridImageFallback(elements.grid);
    elements.grid.setAttribute('aria-busy', 'false');
    elements.grid.innerHTML = state.markupCache.get(state.currentFilter) || "";
    updateResultsSummary(elements.resultsSummary, filtered.length, label);
  }

  async function setFilter(nextFilter) {
    state.currentFilter = normalizeShopFilter(nextFilter);
    syncFilterButtons();
    syncUrlFilter();
    await renderShopPage();
  }

  function getInitialFilter() {
    const params = new URLSearchParams(window.location.search);
    const rawFilter = params.get("category") || params.get("filter") || DEFAULT_FILTER;
    return normalizeShopFilter(rawFilter);
  }

  function initializeShopPage() {
    if (!elements.grid) {
      return;
    }

    // Start syncing products asynchronously
    syncProducts().catch(err => console.error('[Shop] Sync error:', err));
    state.filteredCache.clear();
    state.markupCache.clear();

    if (!elements.filterRoot) {
      return;
    }

    elements.filterRoot.addEventListener("click", event => {
      const button = event.target.closest("button[data-filter]");
      if (!button) {
        return;
      }

      setFilter(button.dataset.filter || DEFAULT_FILTER).catch(err => console.error('[Shop] Filter error:', err));
    });

    setFilter(state.currentFilter).catch(err => console.error('[Shop] Filter error:', err));

    // Re-render from sync payload — do not refetch the catalog.
    productService().then(service => {
      window.addEventListener(service.GLOBAL_SYNC_EVENT, (event) => {
        const products = event?.detail?.products;
        if (!Array.isArray(products)) {
          syncProducts().catch(err => console.error('[Shop] Sync error:', err));
          return;
        }

        getCatalog(products).then((catalog) => {
          state.products = catalog;
          state.filteredCache.clear();
          state.markupCache.clear();
          return renderShopPage();
        }).catch(err => console.error('[Shop] Sync error:', err));
      });
    });
  }

  async function syncProducts() {
    try {
      const service = await productService();
      const cached = service.getCachedProducts();
      if (Array.isArray(cached) && cached.length) {
        state.products = await getCatalog(cached);
        state.filteredCache.clear();
        state.markupCache.clear();
        await renderShopPage();
      }

      const products = await service.getProducts();
      state.products = await getCatalog(products);
      state.filteredCache.clear();
      state.markupCache.clear();
      await renderShopPage();
    } catch (error) {
      console.error('[Shop] Failed to sync products:', error);
      // Attempt to use cached data as fallback
      const service = await productService();
      const cached = service.getCachedProducts();
      if (Array.isArray(cached) && cached.length > 0) {
        state.products = await getCatalog(cached);
        state.filteredCache.clear();
        state.markupCache.clear();
        await renderShopPage();
      }
    }
  }

  window.ByoseShop = {
    buildProductCard,
    createCategoryLabel,
    createProductGridMarkup,
    filterProductsByCategory,
    formatPrice,
    getCatalog,
    getProductHref,
    normalizeProduct,
    renderProductGrid,
    updateResultsSummary
  };

  if (elements.grid) {
    initializeShopPage();
  }
})();
