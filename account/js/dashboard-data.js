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

  function resolveApiOrigin() {
    return String(window.__BYOSE_API_BASE__ || window.BYOSE_API_BASE_URL || window.location.origin || '')
      .replace(/\/+$/, '')
      .replace(/\/api$/i, '');
  }

  const NOTIFICATION_PAGE_SIZE = 20;
  const NOTIFICATION_POLL_MS = 45000;

  const notificationCenter = {
    items: [],
    tips: [],
    unreadCount: 0,
    total: 0,
    hasMore: false,
    offset: 0,
    loading: false,
    error: '',
    bound: false,
    pollTimer: null,
    syncInFlight: false
  };

  function formatNotificationTime(value) {
    if (!value) return 'Recently';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Recently';
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function normalizeDeeplink(href) {
    const raw = String(href || '').trim();
    if (!raw) return 'account.html';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('/account/')) return raw.replace(/^\/account\//, '');
    if (raw.startsWith('/')) return raw.slice(1);
    return raw;
  }

  function buildAccountTips(orders, user) {
    const tips = [];
    const pending = orders.filter((order) => !['delivered', 'returned', 'cancelled'].includes(String(order.orderStatus || '').toLowerCase()));
    if (pending.length) {
      tips.push({
        id: 'tip-pending-orders',
        title: `${pending.length} order${pending.length === 1 ? '' : 's'} need${pending.length === 1 ? 's' : ''} your attention`,
        body: 'Review your active orders and keep track of delivery updates.',
        href: 'orders/all.html',
        kind: 'orders'
      });
    }

    const address = user?.address || {};
    if (!address.city && !address.street && !address.line1 && !address.provinceCity) {
      tips.push({
        id: 'tip-delivery-address',
        title: 'Add a delivery address',
        body: 'Save a delivery address for faster checkout next time.',
        href: 'settings/address.html',
        kind: 'account'
      });
    }

    return tips;
  }

  function formatNotificationTypeLabel(type) {
    const key = String(type || 'SYSTEM').toUpperCase();
    const labels = {
      ORDER_UPDATE: 'Order update',
      SHIPPING_UPDATE: 'Shipping update',
      NEW_PRODUCT: 'New product',
      SYSTEM: 'Account message',
      COUPON_RECEIVED: 'Coupon',
      COUPON_EXPIRING: 'Coupon',
      WISHLIST_PRODUCT_PROMOTION: 'Wishlist',
      FAVORITE_STORE_PROMOTION: 'Store offer',
      FAVORITE_STORE_NEW_PRODUCT: 'Store product'
    };
    return labels[key] || 'Notification';
  }

  function mapNotificationItem(item) {
    return {
      id: item.id,
      type: item.type || 'SYSTEM',
      title: item.title || 'Account update',
      body: item.body || '',
      href: normalizeDeeplink(item.deeplink),
      entityType: item.entityType || '',
      entityId: item.entityId || '',
      createdAt: item.createdAt || null,
      unread: !item.isRead,
      source: 'api'
    };
  }

  function setNotificationStatus(message, tone = '') {
    const status = $('#notificationStatus');
    if (!status) return;
    const text = String(message || '').trim();
    if (!text) {
      status.hidden = true;
      status.textContent = '';
      status.className = 'notification-status';
      return;
    }
    status.hidden = false;
    status.textContent = text;
    status.className = `notification-status${tone ? ` is-${tone}` : ''}`;
  }

  async function resolveNotificationDestination(notification) {
    const entityType = String(notification?.entityType || '').toLowerCase();
    const entityId = String(notification?.entityId || '').trim();
    const href = notification?.href || 'account.html';

    if (entityType === 'product' && entityId) {
      try {
        const response = await fetch(`${resolveApiOrigin()}/api/products/${encodeURIComponent(entityId)}`, {
          headers: { Accept: 'application/json' }
        });
        if (response.ok) {
          return { href: normalizeDeeplink(`/details/product-details1.html?id=${encodeURIComponent(entityId)}`), unavailable: '' };
        }
        return { href: 'account.html', unavailable: 'This product is no longer available.' };
      } catch (_error) {
        return { href, unavailable: '' };
      }
    }

    if (entityType === 'order' && entityId && window.authService?.authFetch) {
      try {
        const response = await window.authService.authFetch(`${resolveApiOrigin()}/api/orders`, {
          headers: { Accept: 'application/json' }
        });
        const payload = await response.json().catch(() => null);
        const orders = Array.isArray(payload?.orders) ? payload.orders : [];
        const owned = orders.some((order) => String(order.orderId || order.id || '') === entityId);
        if (owned) {
          return { href: normalizeDeeplink(`/account/order-details.html?id=${encodeURIComponent(entityId)}`), unavailable: '' };
        }
        return { href: 'orders/all.html', unavailable: 'This order is no longer available in your account.' };
      } catch (_error) {
        return { href, unavailable: '' };
      }
    }

    return { href, unavailable: '' };
  }

  async function fetchServerNotifications({ limit = NOTIFICATION_PAGE_SIZE, offset = 0 } = {}) {
    if (!window.authService?.authFetch || !window.authService.isLoggedIn?.()) {
      return { items: [], unreadCount: 0, total: 0, hasMore: false, offset: 0 };
    }

    const query = new URLSearchParams({
      limit: String(limit),
      offset: String(offset)
    });
    const response = await window.authService.authFetch(`${resolveApiOrigin()}/api/customer-notifications?${query.toString()}`, {
      headers: { Accept: 'application/json' }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(payload?.items)) {
      throw new Error(payload?.message || 'Unable to load notifications.');
    }

    return {
      items: payload.items.map(mapNotificationItem),
      unreadCount: Math.max(0, Number(payload.unreadCount || 0)),
      total: Math.max(0, Number(payload.total || payload.items.length || 0)),
      hasMore: Boolean(payload.hasMore),
      offset: Math.max(0, Number(payload.offset || offset))
    };
  }

  async function syncNotifications({ append = false, silent = false } = {}) {
    if (notificationCenter.syncInFlight) return;
    notificationCenter.syncInFlight = true;
    if (!silent) {
      notificationCenter.loading = true;
      setNotificationStatus('Loading notifications…', 'loading');
    }

    try {
      const offset = append ? notificationCenter.items.length : 0;
      const server = await fetchServerNotifications({ offset });
      notificationCenter.items = append
        ? [...notificationCenter.items, ...server.items.filter((entry) => !notificationCenter.items.some((existing) => Number(existing.id) === Number(entry.id)))]
        : server.items;
      notificationCenter.unreadCount = server.unreadCount;
      notificationCenter.total = server.total;
      notificationCenter.hasMore = server.hasMore;
      notificationCenter.offset = server.offset;
      notificationCenter.error = '';
      setNotificationStatus('');
      renderNotificationList();
      updateNotificationBadge(notificationCenter.unreadCount);
    } catch (error) {
      notificationCenter.error = error?.message || 'Unable to load notifications.';
      if (!notificationCenter.items.length) {
        setNotificationStatus(notificationCenter.error, 'error');
      }
    } finally {
      notificationCenter.loading = false;
      notificationCenter.syncInFlight = false;
      renderNotificationList();
    }
  }

  function stopNotificationPolling() {
    if (notificationCenter.pollTimer) {
      clearInterval(notificationCenter.pollTimer);
      notificationCenter.pollTimer = null;
    }
  }

  function startNotificationPolling() {
    if (!window.authService?.isLoggedIn?.()) return;
    stopNotificationPolling();
    notificationCenter.pollTimer = setInterval(() => {
      if (document.hidden) return;
      syncNotifications({ silent: true }).catch(() => {});
    }, NOTIFICATION_POLL_MS);
  }

  async function markNotificationRead(notificationId) {
    if (!notificationId || !window.authService?.authFetch) return null;
    const response = await window.authService.authFetch(
      `${resolveApiOrigin()}/api/customer-notifications/${encodeURIComponent(notificationId)}/read`,
      { method: 'POST', headers: { Accept: 'application/json' } }
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      throw new Error(payload?.message || 'Unable to mark notification as read.');
    }
    return payload;
  }

  async function markAllNotificationsRead() {
    if (!window.authService?.authFetch) return null;
    const response = await window.authService.authFetch(`${resolveApiOrigin()}/api/customer-notifications/read-all`, {
      method: 'POST',
      headers: { Accept: 'application/json' }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      throw new Error(payload?.message || 'Unable to mark notifications as read.');
    }
    return payload;
  }

  function updateNotificationBadge(count) {
    const badge = $('#notificationBadge');
    if (!badge) return;
    const safeCount = Math.max(0, Number(count) || 0);
    badge.textContent = String(safeCount);
    badge.classList.toggle('is-empty', safeCount === 0);
  }

  function showNotificationListView() {
    const listView = $('#notificationListView');
    const detailView = $('#notificationDetailView');
    if (listView) listView.hidden = false;
    if (detailView) detailView.hidden = true;
  }

  function showNotificationDetailView(notification) {
    const listView = $('#notificationListView');
    const detailView = $('#notificationDetailView');
    const title = $('#notificationDetailTitle');
    const meta = $('#notificationDetailMeta');
    const message = $('#notificationDetailMessage');
    const action = $('#notificationDetailAction');
    const unavailable = $('#notificationDetailUnavailable');
    if (!detailView || !title || !meta || !message || !action) return;

    title.textContent = notification.title || 'Notification';
    meta.textContent = [
      formatNotificationTypeLabel(notification.type),
      formatNotificationTime(notification.createdAt)
    ].filter(Boolean).join(' · ');
    message.textContent = notification.body || notification.title || 'No additional details.';
    action.textContent = notification.source === 'api' ? 'Open related page' : 'Continue';
    action.classList.remove('is-disabled');
    action.href = notification.href || 'account.html';
    if (unavailable) {
      unavailable.hidden = true;
      unavailable.textContent = '';
    }

    if (listView) listView.hidden = true;
    detailView.hidden = false;

    resolveNotificationDestination(notification).then((destination) => {
      if (!destination) return;
      if (destination.unavailable && unavailable) {
        unavailable.hidden = false;
        unavailable.textContent = destination.unavailable;
        action.classList.add('is-disabled');
        action.href = 'account.html';
        action.textContent = 'Related page unavailable';
        return;
      }
      action.href = destination.href || notification.href || 'account.html';
    }).catch(() => {});
  }

  function renderNotificationList() {
    const list = $('#notificationList');
    const markAll = $('#markAllNotificationsRead');
    const loadMore = $('#loadMoreNotifications');
    if (!list) return;

    list.replaceChildren();

    if (!notificationCenter.items.length && !notificationCenter.tips.length) {
      const empty = document.createElement('p');
      empty.className = 'notification-empty-inline';
      empty.textContent = 'You are all caught up. New account updates will appear here.';
      list.append(empty);
    } else {
      if (notificationCenter.items.length) {
        const label = document.createElement('p');
        label.className = 'notification-section-label';
        label.textContent = 'Your notifications';
        list.append(label);

        notificationCenter.items.forEach((notification) => {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = `notification-item${notification.unread ? ' is-unread' : ''}`;
          item.dataset.notificationId = String(notification.id || '');
          item.dataset.source = notification.source || 'api';

          const icon = document.createElement('span');
          icon.className = 'notification-item-icon';
          icon.innerHTML = '<i class="fa-solid fa-bell" aria-hidden="true"></i>';

          const body = document.createElement('span');
          body.className = 'notification-item-body';

          const message = document.createElement('span');
          message.className = 'notification-item-message';
          message.textContent = notification.title;

          const meta = document.createElement('span');
          meta.className = 'notification-item-meta';
          meta.innerHTML = `<span class="notification-item-status" aria-hidden="true"></span>${formatNotificationTime(notification.createdAt)}`;

          body.append(message, meta);
          item.append(icon, body);
          list.append(item);
        });
      }

      if (notificationCenter.tips.length) {
        const label = document.createElement('p');
        label.className = 'notification-section-label';
        label.textContent = 'Account tips';
        list.append(label);

        notificationCenter.tips.forEach((tip) => {
          const item = document.createElement('a');
          item.className = 'notification-item is-tip';
          item.href = tip.href;

          const icon = document.createElement('span');
          icon.className = 'notification-item-icon';
          icon.innerHTML = '<i class="fa-solid fa-lightbulb" aria-hidden="true"></i>';

          const body = document.createElement('span');
          body.className = 'notification-item-body';

          const message = document.createElement('span');
          message.className = 'notification-item-message';
          message.textContent = tip.title;

          const meta = document.createElement('span');
          meta.className = 'notification-item-meta';
          meta.textContent = tip.body;

          body.append(message, meta);
          item.append(icon, body);
          list.append(item);
        });
      }
    }

    if (markAll) {
      markAll.disabled = notificationCenter.unreadCount <= 0 || notificationCenter.loading;
      markAll.hidden = notificationCenter.items.length === 0;
    }

    if (loadMore) {
      loadMore.hidden = !notificationCenter.hasMore;
      loadMore.disabled = notificationCenter.loading;
      loadMore.textContent = notificationCenter.loading ? 'Loading…' : 'Load more notifications';
    }
  }

  let notificationScrollLockY = 0;

  function lockPageScroll() {
    notificationScrollLockY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${notificationScrollLockY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.classList.add('notification-open');
    document.documentElement.classList.add('notification-open');
  }

  function unlockPageScroll() {
    document.body.classList.remove('notification-open');
    document.documentElement.classList.remove('notification-open');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    window.scrollTo(0, notificationScrollLockY);
  }

  function openNotificationPanel() {
    const overlay = $('#notificationOverlay');
    const panel = $('#notificationPanel');
    const toggle = $('#notificationToggle');
    if (!overlay || !panel || !toggle) return;
    showNotificationListView();
    overlay.hidden = false;
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    toggle.classList.add('is-open');
    lockPageScroll();
    syncNotifications({ silent: notificationCenter.items.length > 0 }).catch(() => {});
  }

  function closeNotificationPanel() {
    const overlay = $('#notificationOverlay');
    const panel = $('#notificationPanel');
    const toggle = $('#notificationToggle');
    if (!overlay || !panel || !toggle) return;
    overlay.hidden = true;
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.classList.remove('is-open');
    unlockPageScroll();
    showNotificationListView();
  }

  function bindNotificationCenter() {
    if (notificationCenter.bound) return;
    notificationCenter.bound = true;

    const toggle = $('#notificationToggle');
    const overlay = $('#notificationOverlay');
    const panel = $('#notificationPanel');
    const closeBtn = $('#notificationCloseBtn');
    const markAll = $('#markAllNotificationsRead');
    const detailBack = $('#notificationDetailBack');
    const list = $('#notificationList');
    const loadMore = $('#loadMoreNotifications');

    toggle?.addEventListener('click', () => {
      if (overlay?.hidden) {
        openNotificationPanel();
      } else {
        closeNotificationPanel();
      }
    });

    closeBtn?.addEventListener('click', closeNotificationPanel);
    overlay?.addEventListener('click', (event) => {
      if (event.target === overlay) closeNotificationPanel();
    });

    panel?.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && overlay && !overlay.hidden) {
        closeNotificationPanel();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        syncNotifications({ silent: true }).catch(() => {});
      }
    });

    window.addEventListener('focus', () => {
      syncNotifications({ silent: true }).catch(() => {});
    });

    loadMore?.addEventListener('click', () => {
      syncNotifications({ append: true, silent: false }).catch(() => {});
    });

    detailBack?.addEventListener('click', showNotificationListView);

    markAll?.addEventListener('click', async () => {
      if (notificationCenter.unreadCount <= 0) return;
      markAll.disabled = true;
      try {
        const payload = await markAllNotificationsRead();
        notificationCenter.items = (payload?.items || notificationCenter.items).map(mapNotificationItem);
        notificationCenter.unreadCount = Math.max(0, Number(payload?.unreadCount || 0));
        renderNotificationList();
        updateNotificationBadge(notificationCenter.unreadCount);
      } catch (_error) {
        markAll.disabled = notificationCenter.unreadCount <= 0;
      }
    });

    list?.addEventListener('click', async (event) => {
      const button = event.target?.closest?.('.notification-item[data-notification-id]');
      if (!button) return;
      event.preventDefault();

      const notificationId = Number(button.dataset.notificationId);
      const notification = notificationCenter.items.find((entry) => Number(entry.id) === notificationId);
      if (!notification) return;

      if (notification.unread) {
        try {
          const payload = await markNotificationRead(notification.id);
          notification.unread = false;
          notificationCenter.items = (payload?.items || notificationCenter.items).map(mapNotificationItem);
          notificationCenter.unreadCount = Math.max(0, Number(payload?.unreadCount || 0));
          renderNotificationList();
          updateNotificationBadge(notificationCenter.unreadCount);
        } catch (_error) {
          return;
        }
      }

      showNotificationDetailView(notification);
    });
  }

  async function renderNotifications(orders, user) {
    if (!$('#notificationList') || !$('#notificationBadge') || !$('#notificationToggle')) return;

    await syncNotifications({ silent: false });
    notificationCenter.tips = buildAccountTips(orders, user);
    renderNotificationList();
    bindNotificationCenter();
    startNotificationPolling();
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

    window.addEventListener('beforeunload', () => {
      stopNotificationPolling();
      if (document.body.classList.contains('notification-open')) {
        unlockPageScroll();
      }
    });

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
