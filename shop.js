(function () {
  "use strict";

  const DEFAULT_FILTER = "all";
  const DEFAULT_CATEGORY = "general";
  const DEFAULT_DETAIL_PAGE = "product-details1.html";
  const FALLBACK_IMAGE = "img/logo.png";
  const CATEGORY_ALIASES = {
    apparel: "fashion",
    bag: "fashion",
    bags: "fashion",
    clothes: "fashion",
    clothing: "fashion",
    footwear: "shoes",
    phone: "electronics",
    phones: "electronics",
    shoe: "shoes",
    sneakers: "shoes",
    smartwatch: "electronics",
    smartwatches: "electronics",
    watch: "electronics",
    watches: "electronics"
  };

  const elements = {
    filterRoot: document.querySelector(".filters"),
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

  function normalizePriority(value) {
    return normalizeText(value) === "top" ? "top" : "normal";
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

    const id = Number(product && product.id);
    if (Number.isFinite(id) && id > 0) {
      return `${DEFAULT_DETAIL_PAGE}?id=${encodeURIComponent(id)}`;
    }

    const rawPage = String(product && product.page ? product.page : "").trim();
    if (isSafeHref(rawPage)) {
      return rawPage;
    }

    return DEFAULT_DETAIL_PAGE;
  }

  function normalizeProduct(product, index) {
    const fallbackId = index + 1;
    const id = toPositiveNumber(product && product.id, fallbackId) || fallbackId;
    const price = toPositiveNumber(product && product.price, 0);
    const oldPrice = toPositiveNumber(product && product.oldPrice, 0);
    const name = String(product && product.name ? product.name : "").trim() || `Product ${id}`;
    const badge = String(product && product.badge ? product.badge : "").trim();
    const category = normalizeCategory(product && product.category);
    const image = String(product && (product.mainImage || product.image) ? (product.mainImage || product.image) : "").trim() || FALLBACK_IMAGE;
    const visibility = normalizeVisibility(product && product.visibility);
    const priority = normalizePriority(product && product.priority);
    const orderIndex = toPositiveNumber(product && product.orderIndex, 0);
    const highlightTag = normalizeHighlightTag(product && product.highlightTag);
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
      highlightTag,
      defaultIndex: index,
      image,
      keywords,
      oldPrice: oldPrice > price ? oldPrice : 0,
      page: DEFAULT_DETAIL_PAGE,
      price,
      href,
      url: href
    };
  }

  function shouldShowOnSurface(product, surface) {
    const visibility = normalizeVisibility(product && product.visibility);
    return visibility === "both" || visibility === surface;
  }

  function sortProductsByDisplay(items) {
    return items.slice().sort((left, right) => {
      const leftPriority = left && left.priority === "top" ? 1 : 0;
      const rightPriority = right && right.priority === "top" ? 1 : 0;

      if (leftPriority !== rightPriority) {
        return rightPriority - leftPriority;
      }

      const leftOrder = toPositiveNumber(left && left.orderIndex, 0);
      const rightOrder = toPositiveNumber(right && right.orderIndex, 0);
      if (leftOrder !== rightOrder) {
        return rightOrder - leftOrder;
      }

      return toPositiveNumber(left && left.defaultIndex, 0) - toPositiveNumber(right && right.defaultIndex, 0);
    });
  }

  function getCatalog(source) {
    const items = Array.isArray(source) ? source : Array.isArray(window.products) ? window.products : [];
    return sortProductsByDisplay(
      items
        .map(normalizeProduct)
        .filter(product => shouldShowOnSurface(product, "shop"))
    );
  }

  function buildProductCard(product) {
    const name = escapeHtml(product && product.name);
    const category = escapeHtml(createCategoryLabel(product && product.category));
    const highlightLabel = getHighlightTagLabel(product && product.highlightTag);
    const href = escapeHtml((product && product.href) || getProductHref(product));
    const image = escapeHtml(product && product.image);
    const badge = product && product.badge ? `<span class="shop-card-badge">${escapeHtml(product.badge)}</span>` : "";
    const meta = escapeHtml(highlightLabel || (product && product.badge) || "Featured");
    const hasOldPrice = Number(product && product.oldPrice) > Number(product && product.price);

    return `
      <article class="shop-card" aria-label="${name}">
        <a class="shop-card-media" href="${href}" aria-label="View ${name}">
          <img src="${image}" alt="${name}" loading="lazy" decoding="async">
          ${badge}
        </a>
        <div class="shop-card-content">
          <span class="shop-card-category">${category}</span>
          <h3 class="shop-card-title">${name}</h3>
          <div class="shop-card-price-row">
            <span class="shop-card-price">${formatPrice(product && product.price)}</span>
            ${hasOldPrice ? `<span class="shop-card-old-price">${formatPrice(product.oldPrice)}</span>` : ""}
          </div>
          <div class="shop-card-foot">
            <span class="shop-card-meta">${meta}</span>
            <a class="shop-card-link" href="${href}">
              <span>View</span>
              <i class="fa-solid fa-arrow-right"></i>
            </a>
          </div>
        </div>
      </article>
    `;
  }

  function createProductGridMarkup(items, emptyMessage) {
    if (!Array.isArray(items) || !items.length) {
      return `<div class="shop-empty">${escapeHtml(emptyMessage || "No products available right now.")}</div>`;
    }

    return items.map(buildProductCard).join("");
  }

  function bindGridImageFallback(targetGrid) {
    if (!targetGrid || targetGrid.dataset.shopImageFallbackBound === "true") {
      return;
    }

    targetGrid.dataset.shopImageFallbackBound = "true";
    targetGrid.addEventListener("error", event => {
      const image = event.target;

      if (!(image instanceof HTMLImageElement) || image.dataset.fallbackApplied === "true") {
        return;
      }

      image.dataset.fallbackApplied = "true";
      image.src = FALLBACK_IMAGE;
    }, true);
  }

  function renderProductGrid(targetGrid, items, emptyMessage) {
    if (!targetGrid) {
      return;
    }

    bindGridImageFallback(targetGrid);
    targetGrid.innerHTML = createProductGridMarkup(items, emptyMessage);
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
    if (!normalizedCategory || normalizedCategory === DEFAULT_FILTER) {
      return items;
    }

    return items.filter(product => normalizeCategory(product && product.category) === normalizedCategory);
  }

  function getFilteredProducts(category) {
    const normalizedCategory = normalizeCategory(category);
    if (normalizedCategory === DEFAULT_FILTER) {
      return state.products;
    }

    if (!state.filteredCache.has(normalizedCategory)) {
      state.filteredCache.set(normalizedCategory, filterProductsByCategory(state.products, normalizedCategory));
    }

    return state.filteredCache.get(normalizedCategory) || [];
  }

  function syncFilterButtons() {
    const buttons = Array.from(document.querySelectorAll(".filters button"));
    buttons.forEach(button => {
      const buttonFilter = normalizeCategory(button.dataset.filter || DEFAULT_FILTER);
      const isActive = buttonFilter === state.currentFilter;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  }

  function syncUrlFilter() {
    if (typeof window.history.replaceState !== "function") {
      return;
    }

    const url = new URL(window.location.href);
    if (state.currentFilter === DEFAULT_FILTER) {
      url.searchParams.delete("category");
    } else {
      url.searchParams.set("category", state.currentFilter);
    }

    window.history.replaceState({}, "", url);
  }

  function renderShopPage() {
    if (!elements.grid) {
      return;
    }

    const filtered = getFilteredProducts(state.currentFilter);
    const label = state.currentFilter === DEFAULT_FILTER ? "All items" : createCategoryLabel(state.currentFilter);

    if (!state.markupCache.has(state.currentFilter)) {
      state.markupCache.set(
        state.currentFilter,
        createProductGridMarkup(filtered, "No products available in this category right now.")
      );
    }

    bindGridImageFallback(elements.grid);
    elements.grid.innerHTML = state.markupCache.get(state.currentFilter) || "";
    updateResultsSummary(elements.resultsSummary, filtered.length, label);
  }

  function setFilter(nextFilter, options) {
    const config = options || {};
    const normalizedFilter = normalizeCategory(nextFilter);
    state.currentFilter = normalizedFilter || DEFAULT_FILTER;
    syncFilterButtons();

    if (!config.skipUrlUpdate) {
      syncUrlFilter();
    }

    renderShopPage();
  }

  function getInitialFilter() {
    const params = new URLSearchParams(window.location.search);
    const rawFilter = params.get("category") || params.get("filter") || DEFAULT_FILTER;
    const normalizedFilter = normalizeCategory(rawFilter);
    return normalizedFilter || DEFAULT_FILTER;
  }

  function initializeShopPage() {
    syncProducts();
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

      setFilter(button.dataset.filter || DEFAULT_FILTER);
    });

    setFilter(state.currentFilter, { skipUrlUpdate: true });

    window.addEventListener("byose:products-changed", syncProducts);
  }

  function syncProducts() {
    state.products = getCatalog(window.products);
    state.filteredCache.clear();
    state.markupCache.clear();
    renderShopPage();
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

  initializeShopPage();
})();
