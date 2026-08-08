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

  main.innerHTML = `
    <section class="container" style="padding: 48px 0;">
      <article class="details-panel" style="text-align:center; display:grid; gap:14px;">
        <span class="section-kicker">Unavailable</span>
        <h1 style="margin:0;">Product not found</h1>
        <p style="margin:0; color: var(--home-muted);">The selected product could not be loaded from the current catalog.</p>
        <div>
          <a href="../shop.html" class="action-btn action-btn-primary" style="text-decoration:none; display:inline-flex;">Back to Shop</a>
        </div>
      </article>
    </section>
  `;
}

function renderHighlights(listRoot, highlights) {
  listRoot.innerHTML = (highlights || []).map(item => `
    <li>
      <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
      <span>${item}</span>
    </li>
  `).join('');
}

function renderDescription(root, paragraphs) {
  root.innerHTML = (paragraphs || []).map(copy => `<p>${copy}</p>`).join('');
}

function renderTrust(root, items) {
  root.innerHTML = (items || []).map(item => `
    <div class="trust-pill">
      <i class="fa-solid fa-shield-heart" aria-hidden="true"></i>
      <span>${item}</span>
    </div>
  `).join('');
}

function renderAccordion(root, sections) {
  root.innerHTML = (sections || []).map(section => {
    let content = '';

    if (section.type === 'paragraphs') {
      content = section.content.map(entry => `<p>${entry}</p>`).join('');
    }

    if (section.type === 'list') {
      content = `<ul>${section.content.map(entry => `<li>${entry}</li>`).join('')}</ul>`;
    }

    if (section.type === 'specs') {
      content = `<div class="spec-grid">${section.content.map(([label, value]) => `
        <div class="spec-item">
          <strong>${label}</strong>
          <span>${value}</span>
        </div>
      `).join('')}</div>`;
    }

    return `
      <section class="accordion-item${section.open ? ' is-open' : ''}">
        <button type="button" class="accordion-trigger" aria-expanded="${section.open ? 'true' : 'false'}" aria-controls="panel-${section.id}" id="trigger-${section.id}">
          <span>${section.title}</span>
          <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
        </button>
        <div class="accordion-panel" id="panel-${section.id}" role="region" aria-labelledby="trigger-${section.id}"${section.open ? '' : ' hidden'}>
          ${content}
        </div>
      </section>
    `;
  }).join('');

  Array.from(root.querySelectorAll('.accordion-trigger')).forEach(trigger => {
    trigger.addEventListener('click', () => {
      const item = trigger.closest('.accordion-item');
      const panel = item?.querySelector('.accordion-panel');
      const isOpen = trigger.getAttribute('aria-expanded') === 'true';

      trigger.setAttribute('aria-expanded', String(!isOpen));
      item?.classList.toggle('is-open', !isOpen);
      if (panel) {
        panel.hidden = isOpen;
      }
    });
  });
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

function applyMeta(product) {
  const pageTitle = String(product.metaTitle || product.name || "Product").trim();
  document.title = `${pageTitle} | Byose Market`;

  const description = document.querySelector('meta[name="description"]');
  if (description) {
    const content = String(product.metaDescription || product.shortDescription || "").trim();
    description.setAttribute("content", content);
  }
}

function populateProduct(product) {
  document.getElementById('productCategory').textContent = product.categoryLabel;
  document.getElementById('productBadge').textContent = product.badgeLabel;
  document.getElementById('productName').textContent = product.name;
  document.getElementById('productStars').innerHTML = renderStars(product.rating);
  document.getElementById('productRatingText').textContent = `${product.rating} rating • ${product.reviewCount} reviews`;
  document.getElementById('productPrice').textContent = formatPrice(product.price);
  document.getElementById('productOldPrice').textContent = Number(product.oldPrice) > Number(product.price) ? formatPrice(product.oldPrice) : '';
  document.getElementById('productSavings').textContent = product.discount > 0 ? `Save ${product.discount}%` : 'Best value';
  document.getElementById('productStock').textContent = product.stockLabel;
  document.getElementById('productShortDescription').textContent = product.shortDescription;

  renderHighlights(document.getElementById('productHighlights'), product.highlights);
  renderDescription(document.getElementById('productDescription'), product.longDescription);
  renderTrust(document.getElementById('trustGrid'), product.trust);
  renderAccordion(document.getElementById('detailsAccordion'), product.accordion);
}

document.addEventListener('DOMContentLoaded', () => {
  void (async () => {
    const product = await loadProductData();
    if (!product) {
      showNotFound();
      return;
    }

    const showToast = setupToast();
    applyMeta(product);
    populateProduct(product);

    initProductGallery({
      mainImage: product.mainImage,
      gallery: product.gallery,
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
      showToast
    });

    const wishlistBtn = document.getElementById('wishlistBtn');
    const wishlistLabel = document.getElementById('wishlistBtnLabel');
    const productId = String(product.id || product.catalogId || '');
    if (wishlistBtn && productId) {
      wishlistBtn.setAttribute('data-wishlist-id', productId);

      const syncWishlistButton = () => {
        const active = window.ByoseWishlist?.isWishlisted?.(productId);
        wishlistBtn.classList.toggle('is-active', Boolean(active));
        wishlistBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
        if (wishlistLabel) {
          wishlistLabel.textContent = active ? 'Saved to Wishlist' : 'Add to Wishlist';
        }
        const icon = wishlistBtn.querySelector('.wishlist-btn-icon');
        if (icon) {
          icon.classList.toggle('fa-solid', Boolean(active));
          icon.classList.toggle('fa-regular', !active);
        }
      };

      if (window.ByoseWishlist?.ensureSynced) {
        window.ByoseWishlist.ensureSynced().then(syncWishlistButton).catch(syncWishlistButton);
      } else {
        syncWishlistButton();
      }

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

    const relatedProducts = await getRelatedProducts(product);
    renderRelatedProducts(document.getElementById('relatedProducts'), relatedProducts);

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
  })();
});
