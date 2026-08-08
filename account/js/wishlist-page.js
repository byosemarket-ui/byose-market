(function () {
  'use strict';

  const root = document.getElementById('wishlistItems');
  const statusHost = document.getElementById('wishlistStatusHost');
  const clearBtn = document.getElementById('clearWishlist');
  const countChip = document.getElementById('wishlistCountChip');
  const countLabel = document.getElementById('wishlistCountLabel');
  const toast = document.getElementById('wishlistToast');
  let toastTimer = null;
  let currentWishlist = { items: [], count: 0 };
  let loading = false;

  function formatCurrency(value) {
    return `RWF ${Number(value || 0).toLocaleString('en-US')}`;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function productDetailsHref(product) {
    const id = encodeURIComponent(String(product?.id || product?.catalogId || ''));
    return `../../details/product-details1.html?id=${id}`;
  }

  function showToast(message, type) {
    if (!toast || !message) return;
    toast.textContent = message;
    toast.classList.remove('is-error', 'is-success', 'is-visible');
    if (type === 'error') toast.classList.add('is-error');
    if (type === 'success') toast.classList.add('is-success');
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }

  function setCount(count) {
    const total = Number(count || 0);
    if (countChip) {
      countChip.hidden = total <= 0;
    }
    if (countLabel) {
      countLabel.textContent = `${total} item${total === 1 ? '' : 's'}`;
    }
    if (clearBtn) {
      clearBtn.hidden = total <= 0;
    }

    try {
      window.dispatchEvent(new CustomEvent('byose:wishlist-updated', {
        detail: { count: total, ids: (currentWishlist.items || []).map((entry) => String(entry.productId || entry.product?.id || '')) }
      }));
    } catch (_error) {}
  }

  function renderLoading() {
    statusHost.replaceChildren();
    root.className = 'wishlist-skeleton';
    root.replaceChildren();
    for (let i = 0; i < 4; i += 1) {
      const card = document.createElement('div');
      card.className = 'wishlist-skeleton__card';
      card.innerHTML = `
        <div class="wishlist-skeleton__media"></div>
        <div class="wishlist-skeleton__body">
          <div class="wishlist-skeleton__line"></div>
          <div class="wishlist-skeleton__line is-mid"></div>
          <div class="wishlist-skeleton__line is-short"></div>
        </div>
      `;
      root.append(card);
    }
  }

  function renderError(message) {
    root.className = '';
    root.replaceChildren();
    statusHost.replaceChildren();

    const box = document.createElement('div');
    box.className = 'wishlist-error';
    box.innerHTML = `
      <div class="wishlist-error__icon" aria-hidden="true"><i class="fa-solid fa-triangle-exclamation"></i></div>
      <h2>Unable to load wishlist</h2>
      <p>${escapeHtml(message || 'We could not load your wishlist right now.')}</p>
    `;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'af-button is-primary';
    retry.textContent = 'Try again';
    retry.addEventListener('click', () => loadWishlist());
    box.append(retry);
    statusHost.append(box);
    setCount(currentWishlist.count || 0);
  }

  function renderEmpty() {
    root.className = '';
    root.replaceChildren();
    statusHost.replaceChildren();

    const empty = document.createElement('div');
    empty.className = 'wishlist-empty';
    empty.innerHTML = `
      <div class="wishlist-empty__icon" aria-hidden="true"><i class="fa-solid fa-heart"></i></div>
      <h2>Your Wishlist is Empty</h2>
      <p>Save products you love and find them here later.</p>
      <a class="af-button is-primary" href="../../shop.html">Continue Shopping</a>
    `;
    root.append(empty);
    setCount(0);
  }

  function renderStars(rating) {
    if (!Number.isFinite(Number(rating)) || Number(rating) <= 0) {
      return '';
    }
    return `<span class="wishlist-card__rating"><i class="fa-solid fa-star" aria-hidden="true"></i> ${Number(rating).toFixed(1)}</span>`;
  }

  function render(wishlist) {
    currentWishlist = wishlist || { items: [], count: 0 };
    const items = Array.isArray(currentWishlist.items) ? currentWishlist.items.filter((entry) => entry && entry.product) : [];
    statusHost.replaceChildren();
    root.className = 'wishlist-grid';
    root.replaceChildren();
    setCount(items.length);

    if (!items.length) {
      renderEmpty();
      return;
    }

    items.forEach((entry) => {
      const product = entry.product || {};
      const productId = String(entry.productId || product.id || '');
      const article = document.createElement('article');
      article.className = 'wishlist-card';
      article.dataset.productId = productId;

      const discount = Number(product.discountPercent || 0);
      const stock = Number(product.stock || 0);
      const stockClass = stock <= 0 ? 'is-out' : (stock <= 5 ? 'is-low' : '');

      article.innerHTML = `
        <div class="wishlist-card__media">
          <img src="${escapeHtml(product.image || product.mainImage || '../../img/logo.png')}" alt="${escapeHtml(product.name || 'Saved product')}" loading="lazy">
          ${discount > 0 ? `<span class="wishlist-card__discount">-${discount}%</span>` : ''}
        </div>
        <div class="wishlist-card__body">
          <h2>${escapeHtml(product.name || 'Product')}</h2>
          <div class="wishlist-card__meta">
            ${renderStars(product.rating)}
            <span class="wishlist-card__stock ${stockClass}">${escapeHtml(product.stockLabel || (stock > 0 ? 'In stock' : 'Out of stock'))}</span>
          </div>
          <div class="wishlist-card__pricing">
            <p class="wishlist-card__price">${formatCurrency(product.price)}</p>
            ${product.oldPrice > product.price ? `<p class="wishlist-card__old-price">${formatCurrency(product.oldPrice)}</p>` : ''}
          </div>
          <div class="wishlist-card__actions">
            <button type="button" class="af-button is-primary" data-action="add-to-cart"${stock <= 0 ? ' disabled' : ''} aria-label="Add to cart"><i class="fa-solid fa-cart-shopping" aria-hidden="true"></i> Add to Cart</button>
            <a class="af-button" data-action="view" href="${productDetailsHref(product)}">View</a>
            <button type="button" class="af-button is-danger is-full" data-action="remove" aria-label="Remove from wishlist">Remove</button>
          </div>
        </div>
      `;

      const addBtn = article.querySelector('[data-action="add-to-cart"]');
      const removeBtn = article.querySelector('[data-action="remove"]');

      addBtn?.addEventListener('click', async () => {
        addBtn.disabled = true;
        try {
          await addProductToCart(product);
          showToast('Added to cart.', 'success');
        } catch (error) {
          showToast(error.message || 'Unable to add this product to cart.', 'error');
        } finally {
          if (stock > 0) addBtn.disabled = false;
        }
      });

      removeBtn?.addEventListener('click', async () => {
        removeBtn.disabled = true;
        const previous = currentWishlist;
        // Optimistic remove
        const nextItems = items.filter((item) => String(item.productId || item.product?.id) !== productId);
        render({ items: nextItems, count: nextItems.length });
        try {
          const wishlist = window.ByoseWishlist?.removeItem
            ? (await window.ByoseWishlist.removeItem(productId, { silent: true })).wishlist
            : await window.wishlistService.removeItem(productId);
          if (wishlist) {
            render(wishlist);
          }
          showToast('Removed from wishlist.', 'success');
        } catch (error) {
          render(previous);
          showToast('Unable to remove this item. Please try again.', 'error');
        }
      });

      root.append(article);
    });
  }

  async function addProductToCart(product) {
    const payload = {
      id: String(product.id || product.catalogId || ''),
      productId: String(product.id || product.catalogId || ''),
      name: product.name || product.title || 'Product',
      price: Number(product.price || 0),
      oldPrice: Number(product.oldPrice || 0),
      comparePrice: Number(product.oldPrice || 0),
      discountPercent: Number(product.discountPercent || 0),
      image: product.image || product.mainImage || '',
      productImage: product.image || product.mainImage || '',
      stock: Number(product.stock || 0),
      quantity: 1,
      qty: 1
    };

    if (!payload.id) {
      throw new Error('This product is unavailable.');
    }

    if (Number(product.stock || 0) <= 0) {
      throw new Error('This item is currently out of stock.');
    }

    await waitForCart();

    const cart = window.ByoseCart || window.KCart;
    if (!cart || typeof cart.add !== 'function') {
      throw new Error('Cart is unavailable right now. Please refresh and try again.');
    }

    cart.add(payload);
    window.dispatchEvent(new Event('kcart:updated'));
    window.dispatchEvent(new Event('cart:updated'));
  }

  function waitForCart() {
    if (window.ByoseCart || window.KCart) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let tries = 0;
      const timer = window.setInterval(() => {
        tries += 1;
        if (window.ByoseCart || window.KCart || tries > 20) {
          window.clearInterval(timer);
          resolve();
        }
      }, 50);
    });
  }

  async function loadWishlist() {
    if (loading) return;
    loading = true;
    renderLoading();

    try {
      const wishlist = window.ByoseWishlist?.getWishlist
        ? await window.ByoseWishlist.getWishlist()
        : await window.wishlistService.getWishlist();
      render(wishlist);
    } catch (error) {
      const message = error?.status === 401
        ? 'Please sign in to view your wishlist.'
        : 'We could not load your wishlist right now.';
      renderError(message);
    } finally {
      loading = false;
    }
  }

  clearBtn?.addEventListener('click', async () => {
    if (!currentWishlist.items?.length) return;
    clearBtn.disabled = true;
    try {
      let wishlist;
      if (window.wishlistService?.clear) {
        wishlist = await window.wishlistService.clear();
      } else if (window.ByoseWishlist?.getWishlist) {
        // Fallback: remove one by one
        for (const entry of currentWishlist.items.slice()) {
          await window.ByoseWishlist.removeItem(entry.productId || entry.product?.id, { silent: true });
        }
        wishlist = { items: [], count: 0 };
      }
      render(wishlist || { items: [], count: 0 });
      showToast('Wishlist cleared.', 'success');
    } catch (_error) {
      showToast('Unable to clear wishlist. Please try again.', 'error');
      await loadWishlist();
    } finally {
      clearBtn.disabled = false;
    }
  });

  loadWishlist();
})();
