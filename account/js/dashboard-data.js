(function () {
  'use strict';

  const WISHLIST_KEYS = ['byose_market_wishlist_v1', 'byose_market_wishlist'];
  const RECENT_KEY = 'byose_market_recently_viewed';
  const $ = (selector) => document.querySelector(selector);

  function readList(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (error) {
      return [];
    }
  }

  function readWishlistLocal() {
    for (const key of WISHLIST_KEYS) {
      const items = readList(key);
      if (items.length) return items;
    }
    return [];
  }

  function setText(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value;
  }

  function setFeatureCount(selector, count) {
    const element = $(selector);
    if (!element) return;
    const total = Number(count || 0);
    element.hidden = total <= 0;
    element.textContent = String(total);
  }

  function applyFeatureSummaries({ wishlistCount = 0, recentCount = 0, couponCount = 0, storesCount = 0 } = {}) {
    setText('#accountWishlistCount', String(wishlistCount));
    setFeatureCount('#wishlistFeatureCount', wishlistCount);
    setFeatureCount('#recentFeatureCount', recentCount);
    setFeatureCount('#couponsFeatureCount', couponCount);
    setFeatureCount('#storesFeatureCount', storesCount);

    setText('#wishlistSummary', wishlistCount ? `${wishlistCount} saved item${wishlistCount === 1 ? '' : 's'}` : 'Save products you love');
    setText('#recentSummary', recentCount ? `${recentCount} viewed item${recentCount === 1 ? '' : 's'}` : 'Pick up where you left off');
    setText('#couponsSummary', couponCount ? `${couponCount} available` : 'Ready-to-use discounts');
    setText('#storesSummary', storesCount ? `${storesCount} favorite${storesCount === 1 ? '' : 's'}` : 'Follow sellers you trust');
  }

  function formatCurrency(value) {
    return `RWF ${Number(value || 0).toLocaleString('en-US')}`;
  }

  function productHref(product) {
    return `../details/product-details1.html?id=${encodeURIComponent(String(product?.id || product?.catalogId || ''))}`;
  }

  function renderProducts(products, label) {
    const root = $('#products');
    if (!root) return;

    root.replaceChildren();
    if (!products.length) {
      const empty = document.createElement('p');
      empty.className = 'dashboard-empty';
      empty.textContent = 'Recommendations will appear here as products become available.';
      root.append(empty);
      return;
    }

    products.slice(0, 4).forEach((product) => {
      const card = document.createElement('article');
      card.className = 'product-card';
      const media = document.createElement('div');
      media.className = 'product-card__media';
      if (product.image || product.mainImage || product.imageUrl) {
        const image = document.createElement('img');
        image.loading = 'lazy';
        image.alt = product.name || 'Product image';
        image.src = product.image || product.mainImage || product.imageUrl;
        media.append(image);
      }

      const eyebrow = document.createElement('span');
      eyebrow.className = 'product-card__eyebrow';
      eyebrow.textContent = label;
      const title = document.createElement('h4');
      title.textContent = product.name || 'Product';
      const description = document.createElement('p');
      description.textContent = product.shortDescription || product.description || 'Explore this product in our shop.';
      const footer = document.createElement('div');
      footer.className = 'product-card__footer';
      const price = document.createElement('span');
      price.className = 'product-card__price';
      price.textContent = formatCurrency(product.salePrice ?? product.price);
      const link = document.createElement('a');
      link.className = 'product-card__link';
      link.href = productHref(product);
      link.textContent = 'View item';
      footer.append(price, link);
      card.append(media, eyebrow, title, description, footer);
      root.append(card);
    });
  }

  async function loadProducts() {
    const configured = String(window.__BYOSE_API_BASE__ || window.BYOSE_API_BASE_URL || '').replace(/\/+$/, '');
    const origin = String(window.location.origin || '').replace(/\/+$/, '');
    const productsUrl = configured
      ? (/\/api$/i.test(configured) ? `${configured}/products?limit=4` : `${configured}/api/products?limit=4`)
      : `${origin}/api/products?limit=4`;

    try {
      const response = await fetch(productsUrl, { headers: { Accept: 'application/json' } });
      const payload = await response.json();
      return Array.isArray(payload?.products) ? payload.products : (Array.isArray(payload) ? payload : []);
    } catch (error) {
      return [];
    }
  }

  async function renderNotifications(orders, user) {
    const list = $('#notificationList');
    const badge = $('#notificationBadge');
    const toggle = $('#notificationToggle');
    const panel = $('#notificationPanel');
    const markAll = $('#markAllNotificationsRead');
    if (!list || !badge || !toggle || !panel) return;

    const notifications = [];

    try {
      if (window.authService?.authFetch && window.authService.isLoggedIn?.()) {
        const origin = String(window.__BYOSE_API_BASE__ || window.BYOSE_API_BASE_URL || window.location.origin || '')
          .replace(/\/+$/, '')
          .replace(/\/api$/i, '');
        const response = await window.authService.authFetch(`${origin}/api/customer-notifications?limit=8`, {
          headers: { Accept: 'application/json' }
        });
        const payload = await response.json().catch(() => null);
        if (response.ok && Array.isArray(payload?.items)) {
          payload.items.forEach((item) => {
            notifications.push({
              id: item.id,
              message: item.title || item.body || 'Account update',
              detail: item.body || '',
              time: item.createdAt ? new Date(item.createdAt).toLocaleDateString() : 'Now',
              href: item.deeplink || 'account.html',
              unread: !item.isRead,
              source: 'api'
            });
          });
        }
      }
    } catch (_error) {}

    const pending = orders.filter((order) => !['delivered', 'returned', 'cancelled'].includes(String(order.orderStatus || '').toLowerCase()));
    if (pending.length) {
      notifications.push({
        message: `${pending.length} order${pending.length === 1 ? '' : 's'} need${pending.length === 1 ? 's' : ''} your attention.`,
        time: 'Now',
        href: 'orders/all.html',
        unread: true,
        source: 'orders'
      });
    }
    if (!user.address?.city && !user.address?.street && !user.address?.line1) {
      notifications.push({
        message: 'Add a delivery address for faster checkout.',
        time: 'Account',
        href: 'settings/address.html',
        unread: true,
        source: 'account'
      });
    }
    if (!notifications.length) {
      notifications.push({
        message: 'Your account is up to date.',
        time: 'Account',
        href: 'account.html',
        unread: false,
        source: 'system'
      });
    }

    list.replaceChildren();
    notifications.forEach((notification) => {
      const item = document.createElement('a');
      item.className = `notification-item${notification.unread ? ' is-unread' : ''}`;
      item.href = notification.href || 'account.html';
      const icon = document.createElement('span');
      icon.className = 'notification-item-icon';
      icon.innerHTML = '<i class="fa-solid fa-bell" aria-hidden="true"></i>';
      const body = document.createElement('span');
      body.className = 'notification-item-body';
      const message = document.createElement('span');
      message.className = 'notification-item-message';
      message.textContent = notification.message;
      const meta = document.createElement('span');
      meta.className = 'notification-item-meta';
      meta.textContent = notification.detail || notification.time;
      body.append(message, meta);
      item.append(icon, body);
      list.append(item);
    });

    const closePanel = () => {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.classList.remove('is-open');
    };
    const updateBadge = (count) => {
      badge.textContent = String(count);
      badge.classList.toggle('is-empty', count === 0);
    };
    const unreadCount = notifications.filter((entry) => entry.unread).length;
    updateBadge(unreadCount);

    // Avoid stacking duplicate listeners on re-render.
    if (toggle.dataset.bound !== 'true') {
      toggle.dataset.bound = 'true';
      toggle.addEventListener('click', () => {
        const opening = panel.hidden;
        panel.hidden = !opening;
        toggle.setAttribute('aria-expanded', String(opening));
        toggle.classList.toggle('is-open', opening);
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closePanel();
      });
    }

    if (markAll && markAll.dataset.bound !== 'true') {
      markAll.dataset.bound = 'true';
      markAll.addEventListener('click', async () => {
        list.querySelectorAll('.is-unread').forEach((node) => node.classList.remove('is-unread'));
        updateBadge(0);
        try {
          const origin = String(window.__BYOSE_API_BASE__ || window.BYOSE_API_BASE_URL || window.location.origin || '')
            .replace(/\/+$/, '')
            .replace(/\/api$/i, '');
          await window.authService?.authFetch?.(`${origin}/api/customer-notifications/read-all`, {
            method: 'POST',
            headers: { Accept: 'application/json' }
          });
        } catch (_error) {}
      });
    }
  }

  async function loadFeatureSummaries() {
    const localWishlist = readWishlistLocal();
    const localRecent = readList(RECENT_KEY);

    let wishlistCount = localWishlist.length;
    let recentCount = localRecent.length;
    let couponCount = 0;
    let storesCount = 0;
    let recentProducts = localRecent;

    try {
      if (window.ByoseWishlist?.getCachedIds) {
        wishlistCount = window.ByoseWishlist.getCachedIds().length;
      }
      if (window.ByoseWishlist?.ensureSynced) {
        await window.ByoseWishlist.ensureSynced();
        wishlistCount = window.ByoseWishlist.getCachedIds().length;
      } else if (window.wishlistService?.getWishlist) {
        const wishlist = await window.wishlistService.getWishlist();
        wishlistCount = Number(wishlist.count || wishlist.items?.length || 0);
      }
    } catch (error) {}

    try {
      if (window.recentlyViewedTracker?.getCount) {
        recentCount = await window.recentlyViewedTracker.getCount();
      } else if (window.recentlyViewedService?.getHistory) {
        const history = await window.recentlyViewedService.getHistory(4);
        recentCount = Number(history.count || history.items?.length || 0);
        recentProducts = (history.items || [])
          .map((entry) => entry.product)
          .filter(Boolean);
      }

      if (window.recentlyViewedService?.getHistory) {
        const history = await window.recentlyViewedService.getHistory(4);
        recentProducts = (history.items || [])
          .map((entry) => entry.product)
          .filter(Boolean);
        if (!window.recentlyViewedTracker?.getCount) {
          recentCount = Number(history.count || recentProducts.length || 0);
        }
      }
    } catch (error) {}

    try {
      if (window.couponService?.getCounts) {
        const counts = await window.couponService.getCounts();
        couponCount = Number(counts.available || 0);
      } else if (window.couponService?.getAvailable) {
        const coupons = await window.couponService.getAvailable();
        couponCount = Number(coupons.counts?.available || coupons.items?.length || 0);
      }
    } catch (error) {}

    try {
      if (window.ByoseFavoriteStores?.getCount) {
        storesCount = await window.ByoseFavoriteStores.getCount();
      } else if (window.favoriteStoresService?.getFavorites) {
        const favorites = await window.favoriteStoresService.getFavorites();
        storesCount = Number(favorites.count || favorites.items?.length || 0);
      }
    } catch (error) {}

    applyFeatureSummaries({ wishlistCount, recentCount, couponCount, storesCount });

    return recentProducts;
  }

  async function initializeDashboard() {
    if (window.authService?.whenReady) {
      await window.authService.whenReady().catch(() => {});
    }
    const user = window.authService?.getCurrentUser?.();
    if (!user) return;

    const orders = window.orderService?.getOrders ? await window.orderService.getOrders(user.id) : [];
    const address = user.address || {};
    const recentProducts = await loadFeatureSummaries();

    setText('#accountOrderCount', String(orders.length));
    setText('#addressSummary', [address.city, address.street || address.line1].filter(Boolean).join(', ') || 'Add a delivery address');
    setText('#ordersSummary', orders.length ? `${orders.length} order${orders.length === 1 ? '' : 's'} in your history` : 'No orders yet');
    await renderNotifications(orders, user);

    const products = recentProducts.length ? recentProducts : await loadProducts();
    renderProducts(products, recentProducts.length ? 'Recently viewed' : 'Recommended');

    window.addEventListener('byose:wishlist-updated', (event) => {
      const count = Number(event?.detail?.count);
      if (!Number.isFinite(count)) return;
      setText('#accountWishlistCount', String(count));
      setFeatureCount('#wishlistFeatureCount', count);
      setText('#wishlistSummary', count ? `${count} saved item${count === 1 ? '' : 's'}` : 'Save products you love');
    });

    window.addEventListener('byose:recently-viewed-updated', (event) => {
      const count = Number(event?.detail?.count);
      if (!Number.isFinite(count)) return;
      setFeatureCount('#recentFeatureCount', count);
      setText('#recentSummary', count ? `${count} viewed item${count === 1 ? '' : 's'}` : 'Pick up where you left off');
    });

    window.addEventListener('byose:coupons-updated', (event) => {
      const available = Number(event?.detail?.counts?.available);
      if (Number.isFinite(available)) {
        setFeatureCount('#couponsFeatureCount', available);
        setText('#couponsSummary', available ? `${available} available` : 'Ready-to-use discounts');
        return;
      }
      // After order/checkout, refresh available coupon count from light API.
      const refreshCounts = window.couponService?.getCounts
        ? window.couponService.getCounts()
        : window.couponService?.getAvailable?.().then((coupons) => coupons.counts || {});
      if (refreshCounts) {
        refreshCounts.then((counts) => {
          const next = Number(counts?.available || 0);
          setFeatureCount('#couponsFeatureCount', next);
          setText('#couponsSummary', next ? `${next} available` : 'Ready-to-use discounts');
        }).catch(() => {});
      }
    });

    window.addEventListener('byose:favorite-stores-updated', (event) => {
      const count = Number(event?.detail?.count);
      if (!Number.isFinite(count)) return;
      setFeatureCount('#storesFeatureCount', count);
      setText('#storesSummary', count ? `${count} favorite${count === 1 ? '' : 's'}` : 'Follow sellers you trust');
    });
  }

  document.addEventListener('DOMContentLoaded', initializeDashboard);
})();
