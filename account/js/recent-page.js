(function () {
  'use strict';

  const root = document.getElementById('recentItems');
  const statusHost = document.getElementById('recentStatusHost');
  const clearBtn = document.getElementById('clearRecent');
  const countChip = document.getElementById('recentCountChip');
  const countLabel = document.getElementById('recentCountLabel');
  const toast = document.getElementById('recentToast');
  let toastTimer = null;
  let currentHistory = { items: [], count: 0 };
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

  function formatViewedAt(value) {
    if (!value) return 'Viewed recently';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Viewed recently';

    const now = Date.now();
    const diffMs = now - date.getTime();
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (diffMs < minute) return 'Viewed just now';
    if (diffMs < hour) {
      const mins = Math.max(1, Math.round(diffMs / minute));
      return `Viewed ${mins} min${mins === 1 ? '' : 's'} ago`;
    }
    if (diffMs < day) {
      const hours = Math.max(1, Math.round(diffMs / hour));
      return `Viewed ${hours} hour${hours === 1 ? '' : 's'} ago`;
    }
    if (diffMs < 7 * day) {
      const days = Math.max(1, Math.round(diffMs / day));
      return `Viewed ${days} day${days === 1 ? '' : 's'} ago`;
    }

    return `Viewed ${date.toLocaleDateString()} at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
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

  function emitCount(count) {
    const total = Number(count || 0);
    try {
      window.dispatchEvent(new CustomEvent('byose:recently-viewed-updated', {
        detail: { count: total, source: 'recent-page' }
      }));
    } catch (_error) {}
  }

  function setCount(count) {
    const total = Number(count || 0);
    if (countChip) countChip.hidden = total <= 0;
    if (countLabel) countLabel.textContent = `${total} item${total === 1 ? '' : 's'}`;
    if (clearBtn) clearBtn.hidden = total <= 0;
    emitCount(total);
  }

  function renderLoading() {
    statusHost.replaceChildren();
    root.className = 'recent-skeleton';
    root.replaceChildren();
    for (let i = 0; i < 4; i += 1) {
      const card = document.createElement('div');
      card.className = 'recent-skeleton__card';
      card.innerHTML = `
        <div class="recent-skeleton__media"></div>
        <div class="recent-skeleton__body">
          <div class="recent-skeleton__line"></div>
          <div class="recent-skeleton__line is-mid"></div>
          <div class="recent-skeleton__line is-short"></div>
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
    box.className = 'recent-error';
    box.innerHTML = `
      <div class="recent-error__icon" aria-hidden="true"><i class="fa-solid fa-triangle-exclamation"></i></div>
      <h2>Unable to load recently viewed</h2>
      <p>${escapeHtml(message || 'We could not load your recently viewed products.')}</p>
    `;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'af-button is-primary';
    retry.textContent = 'Try again';
    retry.addEventListener('click', () => loadHistory());
    box.append(retry);
    statusHost.append(box);
    setCount(currentHistory.count || 0);
  }

  function renderEmpty() {
    root.className = '';
    root.replaceChildren();
    statusHost.replaceChildren();

    const empty = document.createElement('div');
    empty.className = 'recent-empty';
    empty.innerHTML = `
      <div class="recent-empty__icon" aria-hidden="true"><i class="fa-solid fa-clock-rotate-left"></i></div>
      <h2>Nothing viewed yet</h2>
      <p>Products you recently viewed will appear here.</p>
      <a class="af-button is-primary" href="../../shop.html">Continue Shopping</a>
    `;
    root.append(empty);
    setCount(0);
  }

  function renderStars(rating) {
    if (!Number.isFinite(Number(rating)) || Number(rating) <= 0) {
      return '';
    }
    return `<span class="recent-card__rating"><i class="fa-solid fa-star" aria-hidden="true"></i> ${Number(rating).toFixed(1)}</span>`;
  }

  function render(history) {
    currentHistory = history || { items: [], count: 0 };
    const items = Array.isArray(currentHistory.items)
      ? currentHistory.items.filter((entry) => entry && entry.product)
      : [];
    statusHost.replaceChildren();
    root.className = 'recent-grid';
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
      article.className = 'recent-card';
      article.dataset.productId = productId;

      const discount = Number(product.discountPercent || 0);
      const stock = Number(product.stock || 0);
      const stockClass = stock <= 0 ? 'is-out' : (stock <= 5 ? 'is-low' : '');

      article.innerHTML = `
        <div class="recent-card__media">
          <img src="${escapeHtml(product.image || product.mainImage || '../../img/logo.png')}" alt="${escapeHtml(product.name || 'Recently viewed product')}" loading="lazy">
          ${discount > 0 ? `<span class="recent-card__discount">-${discount}%</span>` : ''}
        </div>
        <div class="recent-card__body">
          <h2>${escapeHtml(product.name || 'Product')}</h2>
          <div class="recent-card__meta">
            ${renderStars(product.rating)}
            <span class="recent-card__stock ${stockClass}">${escapeHtml(product.stockLabel || (stock > 0 ? 'In stock' : 'Out of stock'))}</span>
            <span class="recent-card__viewed"><i class="fa-regular fa-clock" aria-hidden="true"></i> ${escapeHtml(formatViewedAt(entry.viewedAt))}</span>
          </div>
          <div class="recent-card__pricing">
            <p class="recent-card__price">${formatCurrency(product.price)}</p>
            ${product.oldPrice > product.price ? `<p class="recent-card__old-price">${formatCurrency(product.oldPrice)}</p>` : ''}
          </div>
          <div class="recent-card__actions">
            <button type="button" class="af-button is-primary" data-action="add-to-cart"${stock <= 0 ? ' disabled' : ''} aria-label="Add to cart"><i class="fa-solid fa-cart-shopping" aria-hidden="true"></i> Add to Cart</button>
            <a class="af-button" data-action="view" href="${productDetailsHref(product)}">View</a>
            <button type="button" class="af-button is-danger is-full" data-action="remove" aria-label="Remove from recently viewed">Remove</button>
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
        const previous = currentHistory;
        const nextItems = items.filter((item) => String(item.productId || item.product?.id) !== productId);
        render({ items: nextItems, count: nextItems.length });
        try {
          const next = await window.recentlyViewedService.removeItem(productId);
          render(next);
          showToast('Removed from recently viewed.', 'success');
        } catch (_error) {
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

  async function loadHistory() {
    if (loading) return;
    loading = true;
    renderLoading();

    try {
      const history = await window.recentlyViewedService.getHistory();
      render(history);
    } catch (error) {
      const message = error?.status === 401
        ? 'Please sign in to view your history.'
        : 'We could not load your recently viewed products.';
      renderError(message);
    } finally {
      loading = false;
    }
  }

  clearBtn?.addEventListener('click', async () => {
    if (!currentHistory.items?.length) return;

    const confirmed = window.confirm('Clear all recently viewed products? This will not affect your wishlist.');
    if (!confirmed) return;

    clearBtn.disabled = true;
    try {
      const next = await window.recentlyViewedService.clear();
      render(next || { items: [], count: 0 });
      showToast('Recently viewed history cleared.', 'success');
    } catch (_error) {
      showToast('Unable to clear history. Please try again.', 'error');
      await loadHistory();
    } finally {
      clearBtn.disabled = false;
    }
  });

  loadHistory();
})();
