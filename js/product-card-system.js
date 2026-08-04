/**
 * Unified BYOSE Market Product Card System
 * Single card layout used across Home, Shop, Search, Categories, Featured, Related, etc.
 */

import { normalizeStorefrontAssetUrl, resolveProductImageUrl } from '../services/storefront-asset-url.js';
import { formatDiscountBadgeLabel, resolveProductDiscount } from './storefront-discount.js';

export const ProductCardSystem = (() => {
  'use strict';

  const FALLBACK_IMAGE = 'img/logo.png';
  const DEFAULT_DETAIL_PAGE = 'details/product-details1.html';
  const WISHLIST_KEY = 'byose_market_wishlist_v1';

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

  function formatCurrency(value) {
    const num = Number(value || 0);
    return `RWF ${num.toLocaleString('en-US')}`;
  }

  function getSafeImageUrl(imageSource, product) {
    const resolvedProductImage = product ? resolveProductImageUrl(product) : '';
    const url = resolvedProductImage || normalizeStorefrontAssetUrl(imageSource);
    if (!url || /^javascript:/i.test(url)) {
      return normalizeStorefrontAssetUrl(FALLBACK_IMAGE) || FALLBACK_IMAGE;
    }
    return url;
  }

  function getProductDetailUrl(productId) {
    return `${DEFAULT_DETAIL_PAGE}?id=${encodeURIComponent(String(productId || ''))}`;
  }

  function getWishlistIds() {
    try {
      const raw = window.localStorage.getItem(WISHLIST_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch (_error) {
      return [];
    }
  }

  function isWishlisted(productId) {
    return getWishlistIds().includes(String(productId || ''));
  }

  function toggleWishlist(productId) {
    const id = String(productId || '').trim();
    if (!id) {
      return false;
    }
    const ids = getWishlistIds();
    const index = ids.indexOf(id);
    if (index >= 0) {
      ids.splice(index, 1);
      window.localStorage.setItem(WISHLIST_KEY, JSON.stringify(ids));
      return false;
    }
    ids.push(id);
    window.localStorage.setItem(WISHLIST_KEY, JSON.stringify(ids));
    return true;
  }

  function renderHighlightBadge(product) {
    const tag = String(product?.highlightTag || '').trim().toLowerCase();
    const labels = {
      featured: 'Featured',
      new: 'New',
      trending: 'Flash Deal'
    };
    if (!labels[tag]) {
      return '';
    }
    return `<span class="byose-product-badge byose-product-badge--${escapeHtml(tag)}" aria-label="${escapeHtml(labels[tag])}">${escapeHtml(labels[tag])}</span>`;
  }

  function getCardDisplayName(product) {
    const metadata = product?.metadata && typeof product.metadata === 'object' ? product.metadata : {};
    return String(metadata.shortName || product?.shortName || product?.name || product?.title || 'Product').trim();
  }

  function renderDiscountBadge(product) {
    if (!product) {
      return '';
    }

    const discount = resolveProductDiscount(product);
    if (!discount.hasDiscount || discount.discountPercent <= 0) {
      return '';
    }

    const label = formatDiscountBadgeLabel(discount.discountPercent);
    return `<span class="byose-product-badge byose-product-badge--discount" aria-label="Save ${escapeHtml(String(discount.discountPercent))} percent">${escapeHtml(label)}</span>`;
  }

  function renderWishlistButton(productId) {
    const active = isWishlisted(productId);
    return `
      <button type="button"
              class="byose-product-wishlist ${active ? 'is-active' : ''}"
              data-wishlist-id="${escapeHtml(productId)}"
              aria-label="${active ? 'Remove from wishlist' : 'Add to wishlist'}"
              aria-pressed="${active ? 'true' : 'false'}">
        <span class="byose-product-wishlist-icon" aria-hidden="true">${active ? '♥' : '♡'}</span>
      </button>
    `;
  }

  function renderPricing(product) {
    if (!product) {
      return '';
    }

    const discount = resolveProductDiscount(product);

    return `
      <div class="byose-product-pricing">
        <span class="byose-product-price">${formatCurrency(discount.price)}</span>
        ${discount.hasDiscount ? `<span class="byose-product-old-price">${formatCurrency(discount.oldPrice)}</span>` : ''}
      </div>
    `;
  }

  function renderCard(product, options = {}) {
    if (!product || !product.name) {
      console.warn('[ProductCardSystem] Invalid product data:', product);
      return '';
    }

    const discount = resolveProductDiscount(product);
    const normalizedProduct = {
      ...product,
      price: discount.price,
      oldPrice: discount.oldPrice,
      discountPercent: discount.discountPercent
    };
    const productId = String(product.id || product.catalogId || "");
    const productName = escapeHtml(getCardDisplayName(product));
    const productImage = resolveProductImageUrl(product);
    const displayImage = productImage || normalizeStorefrontAssetUrl(FALLBACK_IMAGE) || FALLBACK_IMAGE;
    const productDetailUrl = escapeHtml(getProductDetailUrl(productId));
    const discountBadge = renderDiscountBadge(normalizedProduct);
    const highlightBadge = renderHighlightBadge(product);
    const pricing = renderPricing(normalizedProduct);
    const wishlistButton = renderWishlistButton(productId);
    const eager = Boolean(options && options.eager);
    const loadingAttr = eager ? 'eager' : 'lazy';
    const fetchPriorityAttr = eager ? ' fetchpriority="high"' : '';

    return `
      <article class="byose-product-card" data-product-id="${escapeHtml(productId)}">
        <div class="byose-product-image-wrapper">
          <a class="byose-product-image-link" href="${productDetailUrl}" aria-label="View ${productName}">
            <img class="byose-product-image"
                 src="${escapeHtml(displayImage)}"
                 data-product-image-src="${escapeHtml(productImage || '')}"
                 data-has-product-image="${productImage ? 'true' : 'false'}"
                 alt="${productName}"
                 loading="${loadingAttr}"
                 decoding="async"${fetchPriorityAttr}>
          </a>
          ${discountBadge}
          ${highlightBadge}
          ${wishlistButton}
        </div>
        <a class="byose-product-content-link" href="${productDetailUrl}">
          <div class="byose-product-content">
            <h3 class="byose-product-title">${productName}</h3>
            ${pricing}
          </div>
        </a>
      </article>
    `;
  }

  function renderCards(products, options = {}) {
    if (!Array.isArray(products) || products.length === 0) {
      return '';
    }
    const eagerCount = Math.max(0, Number(options.eagerCount || 4) || 0);
    return products.map((product, index) => renderCard(product, { eager: index < eagerCount })).join('');
  }

  function renderGrid(products, options = {}) {
    const {
      gridClass = 'byose-product-grid',
      gridColumns = '',
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

    return `<div class="${gridClassList}">${renderCards(products)}</div>`;
  }

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

  function bindWishlistHandlers(containerElement) {
    if (!containerElement || containerElement.dataset.wishlistBound === 'true') {
      return;
    }

    containerElement.dataset.wishlistBound = 'true';

    containerElement.addEventListener('click', event => {
      const button = event.target.closest('[data-wishlist-id]');
      if (!button) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const productId = button.getAttribute('data-wishlist-id');
      const active = toggleWishlist(productId);
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.setAttribute('aria-label', active ? 'Remove from wishlist' : 'Add to wishlist');
      const icon = button.querySelector('.byose-product-wishlist-icon');
      if (icon) {
        icon.textContent = active ? '♥' : '♡';
      }
    });
  }

  function bindCards(containerElement) {
    bindImageFallback(containerElement);
    bindWishlistHandlers(containerElement);
  }

  function updateCard(cardElement, product) {
    if (!cardElement || !product) {
      return;
    }

    const discount = resolveProductDiscount(product);
    const normalizedProduct = {
      ...product,
      price: discount.price,
      oldPrice: discount.oldPrice,
      discountPercent: discount.discountPercent
    };

    const imgElement = cardElement.querySelector('.byose-product-image');
    if (imgElement) {
      imgElement.src = getSafeImageUrl(product.mainImage || product.image, product);
      imgElement.alt = escapeHtml(product.name);
    }

    const titleElement = cardElement.querySelector('.byose-product-title');
    if (titleElement) {
      titleElement.textContent = product.name || product.title || 'Product';
    }

    const pricingElement = cardElement.querySelector('.byose-product-pricing');
    if (pricingElement) {
      pricingElement.outerHTML = renderPricing(normalizedProduct);
    }

    const badge = cardElement.querySelector('.byose-product-badge--discount');
    badge?.remove();

    const imageWrapper = cardElement.querySelector('.byose-product-image-wrapper');
    const discountBadge = renderDiscountBadge(normalizedProduct);
    const wishlistButton = cardElement.querySelector('.byose-product-wishlist');
    if (imageWrapper && discountBadge) {
      wishlistButton
        ? wishlistButton.insertAdjacentHTML('beforebegin', discountBadge)
        : imageWrapper.insertAdjacentHTML('beforeend', discountBadge);
    }
  }

  return {
    FALLBACK_IMAGE,
    DEFAULT_DETAIL_PAGE,
    renderCard,
    renderCards,
    renderGrid,
    renderDiscountBadge,
    renderPricing,
    escapeHtml,
    formatCurrency,
    getSafeImageUrl,
    getProductDetailUrl,
    isWishlisted,
    toggleWishlist,
    bindImageFallback,
    bindWishlistHandlers,
    bindCards,
    updateCard
  };
})();

export default ProductCardSystem;
