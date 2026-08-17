import { formatPrice, getRelatedProducts, loadProductData } from './product-data-loader.js';
import { initProductActions } from './product-actions.js';
import { initProductGallery } from '../gallery.js';
import { renderRelatedProducts } from './related-products.js';

if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

window.addEventListener('load', () => {
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
});

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderStars(rating) {
  const rounded = Math.round(Number(rating || 0));
  return Array.from({ length: 5 }, (_, index) => index < rounded
    ? '<i class="fa-solid fa-star"></i>'
    : '<i class="fa-regular fa-star"></i>').join('');
}

function showNotFound() {
  const main = document.querySelector('.details-main');
  if (!main) {
    return;
  }

  main.classList.remove('is-loading');
  main.innerHTML = `
    <section class="container">
      <article class="details-panel pd-error">
        <span class="section-kicker">Unavailable</span>
        <h1>Product not found</h1>
        <p>The selected product could not be loaded from the current catalog.</p>
        <div>
          <a href="../shop.html" class="action-btn action-btn-primary" style="text-decoration:none; display:inline-flex;">Back to Shop</a>
        </div>
      </article>
    </section>
  `;
}

function renderHighlights(listRoot, highlights) {
  if (!listRoot) {
    return;
  }

  const items = Array.isArray(highlights) ? highlights.filter(Boolean) : [];
  listRoot.hidden = items.length === 0;
  listRoot.innerHTML = items.map(item => `
    <li>
      <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
      <span>${escapeHtml(item)}</span>
    </li>
  `).join('');
}

function renderDescription(root, paragraphs) {
  if (!root) {
    return;
  }

  const items = (paragraphs || []).map((copy) => String(copy || '').trim()).filter(Boolean);
  root.innerHTML = items.map((copy) => `<p>${escapeHtml(copy)}</p>`).join('');

  const storyPanel = root.closest('.story-panel');
  if (storyPanel) {
    storyPanel.hidden = items.length === 0;
  }
}

let descriptionToggleBound = false;

function setupDescriptionToggle(paragraphs) {
  const root = document.getElementById('productDescription');
  const button = document.getElementById('descriptionToggle');
  if (!root || !button) {
    return;
  }

  const textLength = (paragraphs || []).join(' ').replace(/\s+/g, ' ').trim().length;
  const longCopy = textLength > 180 || (paragraphs || []).length > 1;

  function sync() {
    const mobile = window.matchMedia('(max-width: 599px)').matches;
    if (!mobile || !longCopy) {
      root.classList.remove('is-collapsed', 'is-expanded');
      button.hidden = true;
      return;
    }

    button.hidden = false;
    if (!root.classList.contains('is-expanded')) {
      root.classList.add('is-collapsed');
    }
    button.textContent = root.classList.contains('is-expanded') ? 'Read less' : 'Read more';
  }

  if (!descriptionToggleBound) {
    button.addEventListener('click', () => {
      const expanding = !root.classList.contains('is-expanded');
      root.classList.toggle('is-expanded', expanding);
      root.classList.toggle('is-collapsed', !expanding);
      button.textContent = expanding ? 'Read less' : 'Read more';
    });
    window.addEventListener('resize', sync, { passive: true });
    descriptionToggleBound = true;
  }

  root.classList.remove('is-expanded');
  sync();
}

const TRUST_ICONS = ['fa-truck-fast', 'fa-rotate-left', 'fa-lock', 'fa-certificate', 'fa-headset'];

function renderTrust(root, items) {
  if (!root) {
    return;
  }

  const entries = Array.isArray(items) ? items.filter(Boolean) : [];
  root.hidden = entries.length === 0;
  root.innerHTML = entries.map((item, index) => `
    <div class="pd-trust-item">
      <i class="fa-solid ${TRUST_ICONS[index % TRUST_ICONS.length]}" aria-hidden="true"></i>
      <div>
        <strong>${escapeHtml(item)}</strong>
      </div>
    </div>
  `).join('');
}

function renderAccordion(root, sections) {
  if (!root) {
    return;
  }

  const items = (sections || []).filter((section) => {
    if (!section) {
      return false;
    }

    if (Array.isArray(section.content)) {
      return section.content.length > 0;
    }

    return Boolean(section.content);
  });

  root.innerHTML = items.map(section => {
    let content = '';

    if (section.type === 'paragraphs') {
      content = section.content.map(entry => `<p>${escapeHtml(entry)}</p>`).join('');
    }

    if (section.type === 'list') {
      content = `<ul>${section.content.map(entry => `<li>${escapeHtml(entry)}</li>`).join('')}</ul>`;
    }

    if (section.type === 'specs') {
      content = `<div class="spec-grid">${section.content.map(([label, value]) => `
        <div class="spec-item">
          <strong>${escapeHtml(label)}</strong>
          <span>${escapeHtml(value)}</span>
        </div>
      `).join('')}</div>`;
    }

    const preferClosed = window.matchMedia('(max-width: 599px)').matches;
    const isOpen = preferClosed ? false : Boolean(section.open);
    const sectionId = String(section.id || 'section').replace(/[^a-zA-Z0-9_-]/g, '');

    return `
      <section class="accordion-item${isOpen ? ' is-open' : ''}">
        <button type="button" class="accordion-trigger" aria-expanded="${isOpen ? 'true' : 'false'}" aria-controls="panel-${sectionId}" id="trigger-${sectionId}">
          <span>${escapeHtml(section.title)}</span>
          <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
        </button>
        <div class="accordion-panel" id="panel-${sectionId}" role="region" aria-labelledby="trigger-${sectionId}"${isOpen ? '' : ' hidden'}>
          ${content}
        </div>
      </section>
    `;
  }).join('');

  const specsPanel = root.closest('.pd-specs-panel');
  if (specsPanel) {
    specsPanel.hidden = items.length === 0;
  }

  if (root.dataset.accordionBound !== 'true') {
    root.dataset.accordionBound = 'true';
    root.addEventListener('click', (event) => {
      const trigger = event.target.closest('.accordion-trigger');
      if (!trigger || !root.contains(trigger)) {
        return;
      }

      const item = trigger.closest('.accordion-item');
      const panel = item?.querySelector('.accordion-panel');
      const isOpen = trigger.getAttribute('aria-expanded') === 'true';

      trigger.setAttribute('aria-expanded', String(!isOpen));
      item?.classList.toggle('is-open', !isOpen);
      if (panel) {
        panel.hidden = isOpen;
      }
    });
  }
}

function setupToast() {
  const toast = document.getElementById('detailsToast');
  let timeoutId = null;

  return message => {
    if (!toast) {
      return;
    }

    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 2200);
  };
}

function preloadCriticalProductImage(url) {
  const href = String(url || '').trim();
  if (!href || !document.head) {
    return;
  }

  const escaped = (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
    ? CSS.escape(href)
    : href.replace(/"/g, '\\"');
  if (document.querySelector(`link[rel="preload"][as="image"][href="${escaped}"]`)) {
    return;
  }
  if (document.querySelector(`img[src="${escaped}"]`)) {
    return;
  }

  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = href;
  link.setAttribute('fetchpriority', 'high');
  document.head.appendChild(link);
}

function scheduleDeferredWork(callback) {
  const run = () => {
    try {
      callback();
    } catch (_error) {
      // Non-critical deferred work should not break Product Details.
    }
  };

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 1800 });
    return;
  }

  window.setTimeout(run, 1);
}

function applyMeta(product) {
  const pageTitle = String(product.metaTitle || product.name || "Product").trim();
  document.title = `${pageTitle} | Byose Market`;

  const description = document.querySelector('meta[name="description"]');
  if (description) {
    const content = String(product.metaDescription || product.shortDescription || "").trim();
    description.setAttribute("content", content);
  }
}

function setText(id, value, hiddenWhenEmpty = false) {
  const node = document.getElementById(id);
  if (!node) {
    return;
  }

  const text = String(value || '').trim();
  node.textContent = text;
  if (hiddenWhenEmpty) {
    node.hidden = !text;
  }
}

function populateProduct(product) {
  setText('productCategory', product.categoryLabel, true);
  setText('breadcrumbCategory', product.categoryLabel || 'Shop');
  setText('breadcrumbProduct', product.name);
  setText('productName', product.name);
  setText('productShortDescription', product.shortDescription, true);

  const badge = document.getElementById('productBadge');
  if (badge) {
    const label = String(product.badgeLabel || '').trim();
    badge.textContent = label;
    badge.hidden = !label;
  }

  const socialProof = document.getElementById('productSocialProof');
  const hasRating = Number(product.rating) > 0;
  const reviewCount = Number(product.reviewCount) || 0;
  const soldCount = Number(product.soldCount) || 0;
  if (socialProof) {
    socialProof.hidden = !hasRating && reviewCount <= 0 && soldCount <= 0;
  }
  const stars = document.getElementById('productStars');
  if (stars) {
    stars.innerHTML = hasRating ? renderStars(product.rating) : '';
  }
  if (hasRating) {
    const reviewLabel = reviewCount > 0 ? ` (${reviewCount} review${reviewCount === 1 ? '' : 's'})` : '';
    setText('productRatingText', `${product.rating}${reviewLabel}`);
  } else {
    setText('productRatingText', reviewCount > 0 ? `${reviewCount} review${reviewCount === 1 ? '' : 's'}` : '');
  }
  const soldNode = document.getElementById('productSoldCount');
  if (soldNode) {
    soldNode.textContent = soldCount > 0 ? `${soldCount} sold` : '';
    soldNode.hidden = soldCount <= 0;
  }

  setText('productPrice', formatPrice(product.price));
  const oldPriceNode = document.getElementById('productOldPrice');
  const hasOldPrice = Number(product.oldPrice) > Number(product.price);
  if (oldPriceNode) {
    oldPriceNode.textContent = hasOldPrice ? formatPrice(product.oldPrice) : '';
    oldPriceNode.hidden = !hasOldPrice;
  }

  const savings = document.getElementById('productSavings');
  const discountBadge = document.getElementById('galleryDiscountBadge');
  const hasDiscount = Number(product.discount) > 0;
  if (savings) {
    savings.textContent = hasDiscount ? `-${product.discount}%` : '';
    savings.hidden = !hasDiscount;
  }
  if (discountBadge) {
    discountBadge.textContent = hasDiscount ? `-${product.discount}%` : '';
    discountBadge.hidden = !hasDiscount;
  }

  setText('productStock', product.stockLabel);

  renderHighlights(document.getElementById('productHighlights'), product.highlights);
  renderDescription(document.getElementById('productDescription'), product.longDescription);
  setupDescriptionToggle(product.longDescription);
  renderTrust(document.getElementById('trustGrid'), product.trust);
  renderAccordion(document.getElementById('detailsAccordion'), product.accordion);

  const eyebrow = document.querySelector('.info-panel .product-eyebrow-row');
  if (eyebrow) {
    const kicker = document.getElementById('productCategory');
    const badge = document.getElementById('productBadge');
    eyebrow.hidden = Boolean(kicker?.hidden) && Boolean(badge?.hidden);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  void (async () => {
    try {
      const product = await loadProductData();
      if (!product) {
        showNotFound();
        return;
      }

    const showToast = setupToast();
    applyMeta(product);
    populateProduct(product);
    preloadCriticalProductImage(product.cardImage || product.galleryCardImages?.[0] || '');

    const galleryApi = initProductGallery({
      mainImage: product.mainImage,
      gallery: product.gallery,
      cardImage: product.cardImage,
      galleryCardImages: product.galleryCardImages,
      name: product.name,
      root: document.getElementById('productGalleryRoot'),
      track: document.getElementById('galleryTrack'),
      thumbs: document.getElementById('galleryThumbs'),
      prevButton: document.getElementById('galleryPrev'),
      nextButton: document.getElementById('galleryNext'),
      counter: document.getElementById('galleryCounter'),
      zoomButton: document.getElementById('galleryZoom'),
      lightbox: document.getElementById('galleryLightbox'),
      lightboxStage: document.getElementById('lightboxStage'),
      lightboxCounter: document.getElementById('lightboxCounter'),
      lightboxPrev: document.getElementById('lightboxPrev'),
      lightboxNext: document.getElementById('lightboxNext'),
      lightboxClose: document.getElementById('lightboxClose'),
      viewport: document.getElementById('galleryViewport')
    });

    initProductActions({
      product,
      quantityInput: document.getElementById('quantityInput'),
      decreaseButton: document.getElementById('qtyDecrease'),
      increaseButton: document.getElementById('qtyIncrease'),
      addToCartButton: document.getElementById('addToCartBtn'),
      buyNowButton: document.getElementById('buyNowBtn'),
      purchaseCaption: document.getElementById('purchaseCaption'),
      optionsPreviewRoot: document.getElementById('productOptionsPreview'),
      gallery: galleryApi,
      showToast
    });

    document.getElementById('productDetailsPage')?.classList.remove('is-loading');

    const wishlistBtn = document.getElementById('wishlistBtn');
    const galleryWishlistBtn = document.getElementById('galleryWishlistBtn');
    const wishlistLabel = document.getElementById('wishlistBtnLabel');
    const productId = String(product.id || product.catalogId || '');
    if (wishlistBtn && productId) {
      wishlistBtn.setAttribute('data-wishlist-id', productId);
      galleryWishlistBtn?.setAttribute('data-wishlist-id', productId);

      const syncWishlistButton = () => {
        const active = window.ByoseWishlist?.isWishlisted?.(productId);
        [wishlistBtn, galleryWishlistBtn].filter(Boolean).forEach((button) => {
          button.classList.toggle('is-active', Boolean(active));
          button.setAttribute('aria-pressed', active ? 'true' : 'false');
          button.setAttribute('aria-label', active ? 'Remove from wishlist' : 'Add to wishlist');
          const icon = button.querySelector('.wishlist-btn-icon, [data-gallery-wishlist-icon]');
          if (icon) {
            icon.classList.toggle('fa-solid', Boolean(active));
            icon.classList.toggle('fa-regular', !active);
          }
        });
        if (wishlistLabel) {
          wishlistLabel.textContent = active ? 'Saved to Wishlist' : 'Add to Wishlist';
        }
      };

      if (window.ByoseWishlist?.ensureSynced) {
        window.ByoseWishlist.ensureSynced().then(syncWishlistButton).catch(syncWishlistButton);
      } else {
        syncWishlistButton();
      }

      galleryWishlistBtn?.addEventListener('click', () => {
        wishlistBtn.click();
      });

      wishlistBtn.addEventListener('click', async () => {
        if (wishlistBtn.dataset.busy === 'true') return;
        wishlistBtn.dataset.busy = 'true';
        wishlistBtn.disabled = true;
        try {
          if (!window.ByoseWishlist?.toggle) {
            showToast('Wishlist is unavailable right now.');
            return;
          }
          const result = await window.ByoseWishlist.toggle(productId, { silent: true });
          if (result?.redirected) {
            return;
          }
          const active = Boolean(result?.active);
          syncWishlistButton();
          showToast(active ? 'Saved to your wishlist.' : 'Removed from wishlist.');
        } catch (error) {
          syncWishlistButton();
          showToast(
            window.ByoseWishlist?.friendlyError?.(error) || 'Unable to update wishlist.'
          );
        } finally {
          wishlistBtn.dataset.busy = 'false';
          wishlistBtn.disabled = false;
        }
      });

      window.addEventListener('byose:wishlist-updated', syncWishlistButton);
    }

    scheduleDeferredWork(() => {
      void getRelatedProducts(product).then((relatedProducts) => {
        renderRelatedProducts(document.getElementById('relatedProducts'), relatedProducts);
      }).catch(() => {
        renderRelatedProducts(document.getElementById('relatedProducts'), []);
      });
    });

    let syncTimer = 0;
    const syncOpenProduct = () => {
      window.clearTimeout(syncTimer);
      syncTimer = window.setTimeout(() => {
        void loadProductData().then((nextProduct) => {
          if (!nextProduct) {
            return;
          }
          const currentId = String(product.id || product.catalogId || '');
          const nextId = String(nextProduct.id || nextProduct.catalogId || '');
          if (currentId && nextId && currentId !== nextId) {
            return;
          }
          applyMeta(nextProduct);
          populateProduct(nextProduct);
        }).catch(() => {});
      }, 300);
    };

    window.addEventListener('byose:products-synchronized', syncOpenProduct);
    window.addEventListener('byose:products-changed', syncOpenProduct);

    const currentProductId = String(product.id || product.catalogId || '').trim();
    window.addEventListener('pageshow', () => {
      const urlId = String(new URLSearchParams(window.location.search).get('id') || '').trim();
      if (urlId && currentProductId && urlId !== currentProductId) {
        window.location.reload();
      }
    });

    if (window.recentlyViewedTracker && typeof window.recentlyViewedTracker.trackProductView === 'function') {
      void window.recentlyViewedTracker.trackProductView({
        id: product.id || product.catalogId,
        catalogId: product.catalogId || product.id,
        name: product.name,
        title: product.title || product.name,
        price: product.price,
        oldPrice: product.oldPrice,
        discountPercent: product.discountPercent || product.discount,
        image: product.mainImage || product.image,
        mainImage: product.mainImage || product.image,
        stock: product.stockCount ?? product.stock ?? 0
      });
    }
    } catch (error) {
      console.error('Unable to load product details', error);
      showNotFound();
    }
  })();
});
