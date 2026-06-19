/**
 * STEP 3K: Enterprise Product Card System - JavaScript Module
 * 
 * Professional unified product card rendering and management
 * Used across Home, Shop, Featured, Related, Categories, Search, Recommendations
 */

import { normalizeStorefrontAssetUrl, resolveProductImageUrl } from '../services/storefront-asset-url.js';

export const ProductCardSystem = (() => {
  'use strict';

  // Constants
  const FALLBACK_IMAGE = 'img/logo.png';
  const DEFAULT_DETAIL_PAGE = 'details/product-details1.html';
  const DEFAULT_LOW_STOCK_THRESHOLD = 5;
  const BADGE_TYPES = {
    featured: 'featured',
    hot: 'hot',
    trending: 'trending',
    new: 'new',
    sale: 'sale',
    bestseller: 'bestseller'
  };

  /**
   * Escape HTML to prevent XSS attacks
   */
  function escapeHtml(value) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return String(value || '').replace(/[&<>"']/g, char => map[char]);
  }

  /**
   * Format currency value
   */
  function formatCurrency(value) {
    const num = Number(value || 0);
    return `RWF ${num.toLocaleString('en-US')}`;
  }

  /**
   * Format category label
   */
  function formatCategoryLabel(category) {
    return String(category || 'General')
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  function getProductDescription(product) {
    if (!product || typeof product !== 'object') {
      return '';
    }

    const directDescription = String(product.shortDescription || product.description || '').trim();
    if (directDescription) {
      return directDescription;
    }

    if (Array.isArray(product.highlights) && product.highlights.length) {
      return String(product.highlights.find(Boolean) || '').trim();
    }

    if (Array.isArray(product.trust) && product.trust.length) {
      return String(product.trust.find(Boolean) || '').trim();
    }

    return '';
  }

  function normalizeInventoryStatus(available, status, lowStockThreshold = DEFAULT_LOW_STOCK_THRESHOLD) {
    const safeAvailable = Number.isFinite(Number(available)) ? Math.max(0, Number(available)) : 0;
    const safeThreshold = Number.isFinite(Number(lowStockThreshold)) ? Math.max(1, Number(lowStockThreshold)) : DEFAULT_LOW_STOCK_THRESHOLD;
    const normalizedStatus = String(status || '').toLowerCase().trim();

    if (normalizedStatus === 'discontinued') {
      return 'discontinued';
    }

    if (safeAvailable <= 0) {
      return 'out_of_stock';
    }

    if (safeAvailable <= safeThreshold) {
      return 'low_stock';
    }

    return 'in_stock';
  }

  function getInventorySnapshot(product) {
    const inventory = product?.inventory && typeof product.inventory === 'object' ? product.inventory : {};
    const available = Number(
      inventory.available
      ?? inventory.totalAvailable
      ?? product?.availableStock
      ?? product?.stock
      ?? 0
    );
    const lowStockThreshold = Number(inventory.lowStockThreshold ?? product?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD);
    const safeAvailable = Number.isFinite(available) ? Math.max(0, available) : 0;
    const status = normalizeInventoryStatus(safeAvailable, inventory.status || product?.availability, lowStockThreshold);

    return {
      available: safeAvailable,
      status,
      lowStockThreshold: Number.isFinite(lowStockThreshold) ? Math.max(1, lowStockThreshold) : DEFAULT_LOW_STOCK_THRESHOLD
    };
  }

  function getInventoryBadgeModel(snapshot) {
    const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : { available: 0, status: 'out_of_stock' };

    if (safeSnapshot.status === 'out_of_stock' || safeSnapshot.available <= 0) {
      return {
        className: 'byose-product-stock byose-product-stock--empty',
        label: 'Out of Stock'
      };
    }

    if (safeSnapshot.status === 'low_stock') {
      return {
        className: 'byose-product-stock byose-product-stock--low',
        label: 'Low Stock'
      };
    }

    return {
      className: 'byose-product-stock byose-product-stock--healthy',
      label: 'In Stock'
    };
  }

  /**
   * Get safe image URL
   */
  function getSafeImageUrl(imageSource, product) {
    const resolvedProductImage = product ? resolveProductImageUrl(product) : '';
    const url = resolvedProductImage || normalizeStorefrontAssetUrl(imageSource);
    if (!url || /^javascript:/i.test(url)) {
      return normalizeStorefrontAssetUrl(FALLBACK_IMAGE) || FALLBACK_IMAGE;
    }
    return url;
  }

  /**
   * Get safe product detail page URL
   */
  function getProductDetailUrl(productId) {
    const id = escapeHtml(productId);
    return `${DEFAULT_DETAIL_PAGE}?id=${encodeURIComponent(id)}`;
  }

  /**
   * Determine badge type based on product data
   */
  function determineBadgeType(product) {
    if (!product) return null;

    const highlightTag = String(product.highlightTag || '').toLowerCase();
    if (highlightTag === 'featured' || highlightTag === 'trending' || highlightTag === 'new') {
      return highlightTag;
    }

    const badge = String(product.badge || '').toLowerCase();
    if (badge.includes('featured')) return BADGE_TYPES.featured;
    if (badge.includes('hot') || badge.includes('trending')) return BADGE_TYPES.trending;
    if (badge.includes('new')) return BADGE_TYPES.new;
    if (badge.includes('sale')) return BADGE_TYPES.sale;
    if (badge.includes('bestseller') || badge.includes('best seller')) return BADGE_TYPES.bestseller;

    return null;
  }

  /**
   * Render badge HTML
   */
  function renderBadge(product) {
    if (!product || !product.badge) return '';

    const badgeType = determineBadgeType(product);
    const badgeClass = badgeType ? `byose-product-badge--${badgeType}` : '';
    const badgeLabel = escapeHtml(product.badge);

    return `<span class="byose-product-badge ${badgeClass}">${badgeLabel}</span>`;
  }

  /**
   * Render discount/save percentage badge
   */
  function renderDiscountBadge(product) {
    if (!product) return '';

    const oldPrice = Number(product.oldPrice ?? product.compareAtPrice ?? product.originalPrice ?? 0);
    const price = Number(product.price ?? product.salePrice ?? product.currentPrice ?? 0);

    if (oldPrice <= price) return '';

    const discount = Number(product.discountPercent) > 0
      ? Math.round(Number(product.discountPercent))
      : Math.round(((oldPrice - price) / oldPrice) * 100);
    return `<span class="byose-product-badge byose-product-badge--discount" aria-label="Save ${discount} percent">-${discount}%</span>`;
  }

  /**
   * Render pricing section
   */
  function renderPricing(product) {
    if (!product) return '';

    const price = Number(product.price ?? product.salePrice ?? product.currentPrice ?? 0);
    const oldPrice = Number(product.oldPrice ?? product.compareAtPrice ?? product.originalPrice ?? 0);
    const hasDiscount = oldPrice > price;

    let priceHtml = `<span class="byose-product-price">${formatCurrency(price)}</span>`;

    if (hasDiscount) {
      priceHtml += `<span class="byose-product-old-price">${formatCurrency(oldPrice)}</span>`;
    }

    return `<div class="byose-product-pricing">${priceHtml}</div>`;
  }

  /**
   * Render clean storefront product card
   */
  function renderCard(product, options = {}) {
    if (!product || !product.name) {
      console.warn('[ProductCardSystem] Invalid product data:', product);
      return '';
    }

    const { featured = false } = options;

    const productId = escapeHtml(product.id || product.catalogId);
    const productName = escapeHtml(product.name || product.title || 'Product');
    const productImage = resolveProductImageUrl(product);
    const displayImage = productImage || normalizeStorefrontAssetUrl(FALLBACK_IMAGE) || FALLBACK_IMAGE;
    const productDetailUrl = getProductDetailUrl(productId);
    const discountBadge = renderDiscountBadge(product);
    const pricing = renderPricing(product);
    const cardClass = featured ? 'byose-product-card--featured' : '';

    return `
      <article class="byose-product-card ${cardClass}" data-product-id="${productId}">
        <a class="byose-product-card-link" href="${escapeHtml(productDetailUrl)}" aria-label="View ${productName}">
          <div class="byose-product-image-wrapper">
            <img class="byose-product-image"
                 src="${escapeHtml(displayImage)}"
                 data-product-image-src="${escapeHtml(productImage || '')}"
                 data-has-product-image="${productImage ? 'true' : 'false'}"
                 alt="${productName}"
                 loading="lazy"
                 decoding="async">
            ${discountBadge}
          </div>
          <div class="byose-product-content">
            <h3 class="byose-product-title">${productName}</h3>
            ${pricing}
          </div>
        </a>
      </article>
    `;
  }

  /**
   * Render multiple product cards
   */
  function renderCards(products, options = {}) {
    if (!Array.isArray(products) || products.length === 0) {
      return '';
    }

    return products
      .map(product => renderCard(product, options))
      .join('');
  }

  /**
   * Render product grid with unified responsive system
   */
  function renderGrid(products, options = {}) {
    const {
      gridClass = 'byose-product-grid',
      gridColumns = 'auto',
      emptyMessage = 'No products available at this time.'
    } = options;

    if (!Array.isArray(products) || products.length === 0) {
      return `
        <div class="byose-product-grid-empty">
          <div class="byose-product-grid-empty-icon">📭</div>
          <p class="byose-product-grid-empty-text">${escapeHtml(emptyMessage)}</p>
        </div>
      `;
    }

    const gridClassList = [gridClass, gridColumns ? `byose-product-grid--${gridColumns}` : '']
      .filter(Boolean)
      .join(' ');

    const cardsHtml = products
      .map(product => renderCard(product))
      .join('');

    return `<div class="${gridClassList}">${cardsHtml}</div>`;
  }

  /**
   * Bind image fallback error handling
   */
  function bindImageFallback(containerElement) {
    if (!containerElement || containerElement.dataset.cardImageFallbackBound === 'true') {
      return;
    }

    containerElement.dataset.cardImageFallbackBound = 'true';

    containerElement.addEventListener('error', event => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement) || img.dataset.fallbackApplied === 'true') {
        return;
      }

      if (img.dataset.hasProductImage === 'true') {
        const originalSrc = String(img.dataset.productImageSrc || img.getAttribute('src') || '').trim();
        if (originalSrc && img.dataset.retried !== 'true') {
          img.dataset.retried = 'true';
          const separator = originalSrc.includes('?') ? '&' : '?';
          img.src = `${originalSrc}${separator}v=${Date.now()}`;
          return;
        }
        return;
      }

      img.dataset.fallbackApplied = 'true';
      img.src = normalizeStorefrontAssetUrl(FALLBACK_IMAGE) || FALLBACK_IMAGE;
      img.classList.add('is-error');
    }, true);
  }

  /**
   * Update product card content dynamically
   */
  function updateCard(cardElement, product) {
    if (!cardElement || !product) return;

    // Update image
    const imgElement = cardElement.querySelector('.byose-product-image');
    if (imgElement) {
      imgElement.src = getSafeImageUrl(product.mainImage || product.image, product);
      imgElement.alt = escapeHtml(product.name);
    }

    // Update title
    const titleElement = cardElement.querySelector('.byose-product-title');
    if (titleElement) {
      titleElement.textContent = product.name || product.title || 'Product';
    }

    const pricingElement = cardElement.querySelector('.byose-product-pricing');
    if (pricingElement) {
      pricingElement.outerHTML = renderPricing(product);
    }

    const badges = cardElement.querySelectorAll('.byose-product-badge');
    badges.forEach(badge => badge.remove());

    const imageWrapper = cardElement.querySelector('.byose-product-image-wrapper');
    if (imageWrapper) {
      const newDiscountBadge = renderDiscountBadge(product);
      if (newDiscountBadge) {
        imageWrapper.insertAdjacentHTML('beforeend', newDiscountBadge);
      }
    }
  }

  /**
   * Add loading state to card
   */
  function setCardLoading(cardElement, isLoading = true) {
    if (!cardElement) return;
    cardElement.classList.toggle('is-loading', isLoading);
    if (isLoading) {
      cardElement.style.pointerEvents = 'none';
    } else {
      cardElement.style.pointerEvents = '';
    }
  }

  /**
   * Make card featured/highlighted
   */
  function setCardFeatured(cardElement, isFeatured = true) {
    if (!cardElement) return;
    cardElement.classList.toggle('byose-product-card--featured', isFeatured);
  }

  /**
   * Make card muted/de-emphasized
   */
  function setCardMuted(cardElement, isMuted = true) {
    if (!cardElement) return;
    cardElement.classList.toggle('byose-product-card--muted', isMuted);
  }

  return {
    // Constants
    BADGE_TYPES,
    FALLBACK_IMAGE,
    DEFAULT_DETAIL_PAGE,

    // Rendering functions
    renderCard,
    renderCards,
    renderGrid,
    renderBadge,
    renderDiscountBadge,
    renderPricing,

    // Utility functions
    escapeHtml,
    formatCurrency,
    formatCategoryLabel,
    getSafeImageUrl,
    getProductDetailUrl,
    determineBadgeType,

    // DOM manipulation
    bindImageFallback,
    updateCard,
    setCardLoading,
    setCardFeatured,
    setCardMuted
  };
})();

// Export as default
export default ProductCardSystem;
