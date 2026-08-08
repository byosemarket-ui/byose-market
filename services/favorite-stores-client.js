(function (global) {
  'use strict';

  const PRODUCTION_API_ORIGIN = 'https://byosemarket.com';
  const EVENT_NAME = 'byose:favorite-stores-updated';
  const TOAST_ID = 'byoseFavoriteStoresToast';

  let toastTimer = null;
  let cachedCount = null;

  function normalizeBase(value) {
    return String(value || '').trim().replace(/\/+$/, '');
  }

  function isLocalHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
  }

  function shouldUseProductionApi(hostname) {
    return /(^|\.)(github\.io|byosemarket\.com)$/i.test(String(hostname || ''));
  }

  function resolveApiOrigin() {
    const explicit = normalizeBase(global.BYOSE_API_BASE_URL || global.__BYOSE_API_BASE__ || '');
    if (explicit) {
      return explicit.replace(/\/api$/i, '');
    }

    const protocol = String(global.location?.protocol || '').toLowerCase();
    const hostname = String(global.location?.hostname || '').trim();

    if (protocol === 'file:' || isLocalHost(hostname)) {
      return `http://${hostname || 'localhost'}:5000`;
    }

    if (shouldUseProductionApi(hostname)) {
      return PRODUCTION_API_ORIGIN;
    }

    return normalizeBase(global.location?.origin || '');
  }

  function apiUrl(path) {
    return `${resolveApiOrigin()}/api${path}`;
  }

  function isLoggedIn() {
    return Boolean(global.authService && typeof global.authService.isLoggedIn === 'function' && global.authService.isLoggedIn());
  }

  function emitUpdate(detail) {
    const payload = {
      count: Number(detail?.count ?? cachedCount ?? 0),
      ...(detail || {})
    };
    cachedCount = payload.count;
    try {
      global.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
    } catch (_error) {}
    return payload;
  }

  function ensureToastHost() {
    let host = document.getElementById(TOAST_ID);
    if (host) return host;
    host = document.createElement('div');
    host.id = TOAST_ID;
    host.className = 'byose-favorite-stores-toast';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);

    if (!document.getElementById('byoseFavoriteStoresToastStyles')) {
      const style = document.createElement('style');
      style.id = 'byoseFavoriteStoresToastStyles';
      style.textContent = `
        .byose-favorite-stores-toast {
          position: fixed;
          left: 50%;
          bottom: 24px;
          transform: translateX(-50%) translateY(20px);
          z-index: 12000;
          min-width: min(320px, calc(100vw - 32px));
          max-width: calc(100vw - 32px);
          padding: 12px 16px;
          border-radius: 12px;
          background: #132033;
          color: #fff;
          font: 600 0.9rem/1.4 "Plus Jakarta Sans", system-ui, sans-serif;
          box-shadow: 0 12px 28px rgba(19, 32, 51, 0.28);
          opacity: 0;
          pointer-events: none;
          transition: opacity .2s ease, transform .2s ease;
        }
        .byose-favorite-stores-toast.is-visible {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
        .byose-favorite-stores-toast.is-success { background: #0f7a43; }
        .byose-favorite-stores-toast.is-error { background: #b42318; }
      `;
      document.head.appendChild(style);
    }

    return host;
  }

  function showToast(message, type) {
    if (!message) return;
    const host = ensureToastHost();
    host.textContent = message;
    host.classList.remove('is-error', 'is-success', 'is-visible');
    if (type === 'error') host.classList.add('is-error');
    if (type === 'success') host.classList.add('is-success');
    host.classList.add('is-visible');
    global.clearTimeout(toastTimer);
    toastTimer = global.setTimeout(() => host.classList.remove('is-visible'), 2600);
  }

  function friendlyError(error) {
    if (!error) return 'Something went wrong. Please try again.';
    if (error.status === 401) return 'Please sign in to follow stores.';
    if (error.status === 404) return 'Store not found.';
    return 'Unable to update favorite stores. Please try again.';
  }

  function redirectToLogin() {
    const next = encodeURIComponent(`${global.location.pathname}${global.location.search}${global.location.hash}`);
    global.location.href = `login.html?next=${next}`;
  }

  async function authJson(path, options = {}) {
    if (!global.authService || typeof global.authService.authFetch !== 'function') {
      throw new Error('Authentication service is unavailable.');
    }

    if (!isLoggedIn()) {
      const error = new Error('Unauthorized');
      error.status = 401;
      throw error;
    }

    const response = await global.authService.authFetch(apiUrl(path), {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (_error) {
      payload = null;
    }

    if (!response.ok || payload?.success === false) {
      const error = new Error(payload?.message || `Request failed (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  async function publicJson(path, options = {}) {
    const headers = {
      Accept: 'application/json',
      ...(options.headers || {})
    };

    let response;
    if (isLoggedIn() && global.authService?.authFetch) {
      response = await global.authService.authFetch(apiUrl(path), { ...options, headers });
    } else {
      response = await fetch(apiUrl(path), { ...options, headers });
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (_error) {
      payload = null;
    }

    if (!response.ok || payload?.success === false) {
      const error = new Error(payload?.message || `Request failed (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  async function getFavorites() {
    const payload = await authJson('/favorite-stores');
    const favorites = payload.favorites || { items: [], count: 0 };
    emitUpdate({ count: Number(favorites.count || 0), favorites });
    return favorites;
  }

  async function getCount() {
    try {
      const payload = await authJson('/favorite-stores/count');
      const count = Number(payload.count || 0);
      cachedCount = count;
      return count;
    } catch (_error) {
      return Number(cachedCount || 0);
    }
  }

  async function listStores() {
    const payload = await publicJson('/stores');
    return Array.isArray(payload.stores) ? payload.stores : [];
  }

  async function getStore(slugOrId) {
    const payload = await publicJson(`/stores/${encodeURIComponent(String(slugOrId || '').trim())}`);
    return {
      store: payload.store || null,
      products: Array.isArray(payload.products) ? payload.products : []
    };
  }

  async function follow(storeId, options = {}) {
    if (!isLoggedIn()) {
      if (options.redirect !== false) {
        redirectToLogin();
        return { redirected: true };
      }
      const error = new Error('Unauthorized');
      error.status = 401;
      throw error;
    }

    const payload = await authJson('/favorite-stores/follow', {
      method: 'POST',
      body: JSON.stringify({ storeId })
    });
    const favorites = payload.favorites || { items: [], count: 0 };
    emitUpdate({ count: Number(favorites.count || 0), favorites, action: 'follow', storeId });
    if (!options.silent) {
      showToast('You are now following this store.', 'success');
    }
    return { favorites, active: true };
  }

  async function unfollow(storeId, options = {}) {
    if (!isLoggedIn()) {
      if (options.redirect !== false) {
        redirectToLogin();
        return { redirected: true };
      }
      const error = new Error('Unauthorized');
      error.status = 401;
      throw error;
    }

    const payload = await authJson(`/favorite-stores/${encodeURIComponent(storeId)}`, {
      method: 'DELETE'
    });
    const favorites = payload.favorites || { items: [], count: 0 };
    emitUpdate({ count: Number(favorites.count || 0), favorites, action: 'unfollow', storeId });
    if (!options.silent) {
      showToast('Store removed from favorites.', 'success');
    }
    return { favorites, active: false };
  }

  async function toggle(storeId, currentlyFollowing, options = {}) {
    if (currentlyFollowing) {
      return unfollow(storeId, options);
    }
    return follow(storeId, options);
  }

  function updateFollowButton(button, following) {
    if (!button) return;
    const active = Boolean(following);
    button.classList.toggle('is-following', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.textContent = active ? 'Following' : 'Follow';
  }

  global.ByoseFavoriteStores = {
    EVENT_NAME,
    isLoggedIn,
    getFavorites,
    getCount,
    listStores,
    getStore,
    follow,
    unfollow,
    toggle,
    updateFollowButton,
    showToast,
    friendlyError,
    emitUpdate
  };
})(window);
