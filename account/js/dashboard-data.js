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

  function readWishlist() {
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

  function formatCurrency(value) {
    return `RWF ${Number(value || 0).toLocaleString('en-US')}`;
  }

  function productHref(product) {
    return `../details/product-details1.html?id=${encodeURIComponent(String(product?.id || ''))}`;
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
    const base = String(window.__BYOSE_API_BASE__ || window.location.origin || '').replace(/\/+$/, '');
    try {
      const response = await fetch(`${base}/api/products?limit=4`, { headers: { Accept: 'application/json' } });
      const payload = await response.json();
      return Array.isArray(payload?.products) ? payload.products : (Array.isArray(payload) ? payload : []);
    } catch (error) {
      return [];
    }
  }

  function renderNotifications(orders, user) {
    const list = $('#notificationList');
    const badge = $('#notificationBadge');
    const toggle = $('#notificationToggle');
    const panel = $('#notificationPanel');
    const markAll = $('#markAllNotificationsRead');
    if (!list || !badge || !toggle || !panel) return;

    const pending = orders.filter((order) => !['delivered', 'returned', 'cancelled'].includes(String(order.orderStatus || '').toLowerCase()));
    const notifications = [];
    if (pending.length) notifications.push({ message: `${pending.length} order${pending.length === 1 ? '' : 's'} need${pending.length === 1 ? 's' : ''} your attention.`, time: 'Now' });
    if (!user.address?.city && !user.address?.street && !user.address?.line1) notifications.push({ message: 'Add a delivery address for faster checkout.', time: 'Account' });
    if (!notifications.length) notifications.push({ message: 'Your account is up to date.', time: 'Account' });

    list.replaceChildren();
    notifications.forEach((notification) => {
      const item = document.createElement('a');
      item.className = 'notification-item is-unread';
      item.href = notification.message.includes('address') ? 'settings/address.html' : 'orders/all.html';
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
      meta.textContent = notification.time;
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
    updateBadge(notifications.length);
    toggle.addEventListener('click', () => {
      const opening = panel.hidden;
      panel.hidden = !opening;
      toggle.setAttribute('aria-expanded', String(opening));
      toggle.classList.toggle('is-open', opening);
    });
    markAll?.addEventListener('click', () => {
      list.querySelectorAll('.is-unread').forEach((node) => node.classList.remove('is-unread'));
      updateBadge(0);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closePanel();
    });
  }

  async function initializeDashboard() {
    const user = window.authService?.getCurrentUser?.();
    if (!user) return;

    const wishlist = readWishlist();
    const recent = readList(RECENT_KEY);
    const orders = window.orderService?.getOrders ? await window.orderService.getOrders(user.id) : [];
    const address = user.address || {};

    setText('#accountOrderCount', String(orders.length));
    setText('#accountWishlistCount', String(wishlist.length));
    setText('#wishlistSummary', wishlist.length ? `${wishlist.length} saved item${wishlist.length === 1 ? '' : 's'}` : 'Saved products');
    setText('#addressSummary', [address.city, address.street || address.line1].filter(Boolean).join(', ') || 'Add a delivery address');
    setText('#ordersSummary', orders.length ? `${orders.length} order${orders.length === 1 ? '' : 's'} in your history` : 'No orders yet');
    renderNotifications(orders, user);

    const products = recent.length ? recent : await loadProducts();
    renderProducts(products, recent.length ? 'Recently viewed' : 'Recommended');
  }

  document.addEventListener('DOMContentLoaded', initializeDashboard);
})();
