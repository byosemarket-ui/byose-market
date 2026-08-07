/* ========================================
   UTILITY FUNCTIONS - Shared Across App
   ======================================== */

const Util = {
  // DOM SELECTION
  select: (selector, parent = document) => parent.querySelector(selector),
  selectAll: (selector, parent = document) => Array.from(parent.querySelectorAll(selector)),

  // FORMATTING
  formatRWF: (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'RWF',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount || 0);
  },

  formatPrice: (amount) => {
    if (!amount) return 'RWF 0';
    return 'RWF ' + Math.round(amount).toLocaleString('en-US');
  },

  // STORAGE
  getFromStorage: (key, defaultValue = null) => {
    try {
      if (window.ByoseStorefrontSync?.isManagedKey?.(key)) {
        const value = window.ByoseStorefrontSync.readStateByKey(key);
        return value === undefined ? defaultValue : value;
      }

      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (e) {
      console.error('Storage read error:', e);
      return defaultValue;
    }
  },

  setToStorage: (key, value) => {
    try {
      if (window.ByoseStorefrontSync?.isManagedKey?.(key)) {
        return window.ByoseStorefrontSync.writeStateByKey(key, value);
      }

      localStorage.setItem(key, JSON.stringify(value));
      try { window.ByoseStorefrontSync?.syncStorageKey?.(key, value); } catch (syncError) { console.warn(syncError); }
      return true;
    } catch (e) {
      console.error('Storage write error:', e);
      return false;
    }
  },

  removeFromStorage: (key) => {
    try {
      if (window.ByoseStorefrontSync?.isManagedKey?.(key)) {
        return window.ByoseStorefrontSync.removeStateByKey(key);
      }

      localStorage.removeItem(key);
      try { window.ByoseStorefrontSync?.syncStorageKey?.(key, null); } catch (syncError) { console.warn(syncError); }
      return true;
    } catch (e) {
      console.error('Storage remove error:', e);
      return false;
    }
  },

  // STRING & TEXT
  slugify: (str) => {
    return str
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/^-+|-+$/g, '');
  },

  capitalize: (str) => {
    return str.charAt(0).toUpperCase() + str.slice(1);
  },

  // ARRAYS & OBJECTS
  findInArray: (arr, key, value) => arr.find(item => item[key] === value),

  filterArray: (arr, key, value) => arr.filter(item => item[key] === value),

  sumArray: (arr, key) => arr.reduce((sum, item) => sum + (item[key] || 0), 0),

  // EVENTS
  onEvent: (selector, event, callback, parent = document) => {
    const element = typeof selector === 'string' ? parent.querySelector(selector) : selector;
    if (element) {
      element.addEventListener(event, callback);
    }
  },

  onEventAll: (selector, event, callback, parent = document) => {
    parent.querySelectorAll(selector).forEach(element => {
      element.addEventListener(event, callback);
    });
  },

  // TIME & DATE
  getTimeAgo: (timestamp) => {
    const now = new Date();
    const date = new Date(timestamp);
    const seconds = Math.floor((now - date) / 1000);

    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + ' years ago';
    
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + ' months ago';
    
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + ' days ago';
    
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + ' hours ago';
    
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + ' minutes ago';
    
    return Math.floor(seconds) + ' seconds ago';
  },

  // VALIDATION
  isValidEmail: (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  },

  isValidPhone: (phone) => {
    const re = /^[0-9+\-\s()]+$/;
    return re.test(phone) && phone.replace(/\D/g, '').length >= 7;
  },

  // NOTIFICATIONS
  showAlert: (message, type = 'info') => {
    const alertId = 'alert-' + Date.now();
    const alertHTML = `
      <div class="alert alert-${type}" id="${alertId}" role="alert">
        <strong>${type.toUpperCase()}:</strong> ${message}
        <button onclick="document.getElementById('${alertId}').remove()" style="float: right; background: none; border: none; cursor: pointer; font-size: 20px; color: inherit;">&times;</button>
      </div>
    `;
    
    const alertContainer = document.querySelector('.alert-container') || document.body;
    const alertDiv = document.createElement('div');
    alertDiv.innerHTML = alertHTML;
    alertContainer.insertBefore(alertDiv.firstChild, alertContainer.firstChild);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      const el = document.getElementById(alertId);
      if (el) el.remove();
    }, 5000);
  },

  showSuccess: (message) => Util.showAlert(message, 'success'),
  showError: (message) => Util.showAlert(message, 'error'),
  showWarning: (message) => Util.showAlert(message, 'warning'),
  showInfo: (message) => Util.showAlert(message, 'info'),

  // LOADING STATE
  setLoadingState: (selector, isLoading = true, loadingText = 'Loading...') => {
    const element = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!element) return;

    if (isLoading) {
      element.disabled = true;
      element.dataset.originalText = element.textContent;
      element.textContent = loadingText;
      element.classList.add('is-loading');
    } else {
      element.disabled = false;
      element.textContent = element.dataset.originalText || 'Submit';
      element.classList.remove('is-loading');
    }
  },

  // COOKIES
  setCookie: (name, value, days = 7) => {
    const date = new Date();
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
    const expires = 'expires=' + date.toUTCString();
    document.cookie = name + '=' + value + ';' + expires + ';path=/';
  },

  getCookie: (name) => {
    const nameEQ = name + '=';
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
      cookie = cookie.trim();
      if (cookie.indexOf(nameEQ) === 0) return cookie.substring(nameEQ.length);
    }
    return null;
  },

  deleteCookie: (name) => {
    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;';
  },

  // DEEP CLONE
  deepClone: (obj) => JSON.parse(JSON.stringify(obj)),

  // DEBOUNCE
  debounce: (func, delay = 300) => {
    let timeoutId;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func(...args), delay);
    };
  },

  // THROTTLE
  throttle: (func, limit = 300) => {
    let inThrottle;
    return (...args) => {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => { inThrottle = false; }, limit);
      }
    };
  },

  // SCROLL
  scrollToElement: (selector) => {
    const element = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  },

  scrollToTop: () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  // VISIBILITY
  isElementInViewport: (element) => {
    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  },

  // SCREEN SIZE
  getScreenSize: () => {
    if (window.innerWidth <= 640) return 'mobile';
    if (window.innerWidth <= 1024) return 'tablet';
    return 'desktop';
  },

  // RATING DISPLAY
  getStarDisplay: (rating) => {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
      if (i <= rating) {
        stars.push('★');
      } else if (i - rating < 1) {
        stars.push('◆');
      } else {
        stars.push('☆');
      }
    }
    return stars.join('');
  },

  // FETCH WITH ERROR HANDLING
  fetchData: async (url, options = {}) => {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Fetch error:', error);
      return null;
    }
  },

  // REDIRECT
  redirect: (url, delay = 0) => {
    if (delay) {
      setTimeout(() => window.location.href = url, delay);
    } else {
      window.location.href = url;
    }
  },

  // URL PARAMETERS
  getUrlParam: (param) => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
  },

  getAllUrlParams: () => {
    return Object.fromEntries(new URLSearchParams(window.location.search));
  },

  setUrlParam: (param, value) => {
    const url = new URL(window.location);
    url.searchParams.set(param, value);
    window.history.pushState({}, '', url);
  },
};

// Make Util available globally
window.Util = Util;

(function initializeByoseStorefrontSync(global) {
  if (!global || global.ByoseStorefrontSync) {
    return;
  }

  const PRODUCTION_API_ORIGIN = 'https://byosemarket.com/api';
  const STOREFRONT_KEYS = {
    byose_market_cart_v1: 'cartItems',
    byose_direct_checkout: 'directCheckout',
    byose_checkout_draft_v1: 'checkoutDraft',
    byose_checkout_confirmation_v1: 'checkoutConfirmation',
    byose_market_saved_v1: 'savedItems'
  };
  let suppressSync = false;
  let hydrationPromise = null;
  let syncQueue = Promise.resolve({ skipped: true });
  let pendingPatch = null;
  const REQUEST_TIMEOUT_MS = 10000;
  const STOREFRONT_STATE_EVENT = 'byose:storefront-state-updated';
  const stateByField = {
    cartItems: [],
    directCheckout: null,
    checkoutDraft: null,
    checkoutConfirmation: null,
    savedItems: []
  };
  const bootstrapState = {};

  function cloneValue(value) {
    if (value === undefined) {
      return undefined;
    }

    return JSON.parse(JSON.stringify(value));
  }

  function hasValue(value) {
    if (Array.isArray(value)) {
      return value.length > 0;
    }

    return value !== null && value !== undefined;
  }

  function dispatchStateEvent(changedFields = []) {
    const detail = {
      changedFields: Array.from(new Set(changedFields.filter(Boolean))),
      state: cloneValue(stateByField)
    };

    global.dispatchEvent(new CustomEvent(STOREFRONT_STATE_EVENT, { detail }));

    if (detail.changedFields.some((field) => field === 'cartItems' || field === 'directCheckout')) {
      global.dispatchEvent(new Event('kcart:updated'));
      global.dispatchEvent(new Event('cart:updated'));
    }
  }

  function applyField(field, value, options = {}) {
    if (!field) {
      return;
    }

    const normalizedValue = value === undefined ? null : cloneValue(value);
    stateByField[field] = normalizedValue;

    if (options.emit !== false) {
      dispatchStateEvent([field]);
    }
  }

  function readLegacyValue(key) {
    try {
      const raw = global.localStorage.getItem(key);
      if (!raw) {
        return undefined;
      }

      return JSON.parse(raw);
    } catch (_error) {
      return undefined;
    }
  }

  function purgeLegacyStateKey(key) {
    try {
      global.localStorage.removeItem(key);
    } catch (_error) {
      // Ignore storage cleanup failures.
    }
  }

  function readStateByKey(key) {
    const field = STOREFRONT_KEYS[key];
    if (!field) {
      return undefined;
    }

    return cloneValue(stateByField[field]);
  }

  function writeStateByKey(key, value) {
    const field = STOREFRONT_KEYS[key];
    if (!field) {
      return false;
    }

    applyField(field, value);
    if (!getToken()) {
      try {
        if (value === null || value === undefined) {
          global.localStorage.removeItem(key);
        } else {
          global.localStorage.setItem(key, JSON.stringify(value));
        }
      } catch (_error) {
        // Ignore storage quota failures for guest cart persistence.
      }
    }
    if (!suppressSync) {
      void syncPatch({ [field]: value === undefined ? null : cloneValue(value) });
    }
    return true;
  }

  function removeStateByKey(key) {
    return writeStateByKey(key, null);
  }

  function bootstrapLegacyState() {
    Object.entries(STOREFRONT_KEYS).forEach(([key, field]) => {
      const value = readLegacyValue(key);
      if (value === undefined) {
        return;
      }

      bootstrapState[field] = cloneValue(value);
      stateByField[field] = cloneValue(value);
      if (getToken()) {
        purgeLegacyStateKey(key);
      }
    });
  }

  function cartLineIdentity(item) {
    const lineId = String(item?.lineId || '').trim();
    if (lineId) return `line:${lineId}`;
    const productId = String(item?.productId || item?.id || '').trim();
    const variantKey = String(item?.variantKey || '').trim();
    return `pv:${productId}|${variantKey}`;
  }

  function mergeCartItemLists(remoteItems, localItems) {
    const merged = new Map();
    (Array.isArray(remoteItems) ? remoteItems : []).forEach((item) => {
      if (!item) return;
      merged.set(cartLineIdentity(item), cloneValue(item));
    });
    (Array.isArray(localItems) ? localItems : []).forEach((item) => {
      if (!item) return;
      const key = cartLineIdentity(item);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, cloneValue(item));
        return;
      }
      const remoteQty = Math.max(1, Number(existing.qty || existing.quantity) || 1);
      const localQty = Math.max(1, Number(item.qty || item.quantity) || 1);
      merged.set(key, cloneValue({
        ...existing,
        ...item,
        qty: Math.max(remoteQty, localQty),
        quantity: Math.max(remoteQty, localQty),
        selected: existing.selected !== false || item.selected !== false
      }));
    });
    return Array.from(merged.values());
  }

  function buildBootstrapPatch(remoteState) {
    return Object.entries(bootstrapState).reduce((patch, [field, value]) => {
      if (field === 'cartItems' && Array.isArray(value) && value.length) {
        const remoteItems = Array.isArray(remoteState?.cartItems) ? remoteState.cartItems : [];
        if (!remoteItems.length) {
          patch[field] = cloneValue(value);
          return patch;
        }

        const merged = mergeCartItemLists(remoteItems, value);
        const remoteSignature = JSON.stringify(remoteItems);
        const mergedSignature = JSON.stringify(merged);
        if (mergedSignature !== remoteSignature) {
          patch[field] = merged;
        }
        return patch;
      }

      if (!hasValue(value) || hasValue(remoteState?.[field])) {
        return patch;
      }

      patch[field] = cloneValue(value);
      return patch;
    }, {});
  }

  bootstrapLegacyState();

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
      return explicit;
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

  function getStorefrontStateUrl() {
    const base = resolveApiOrigin();
    if (!base) {
      return '';
    }

    return base.endsWith('/api') ? `${base}/storefront/state` : `${base}/api/storefront/state`;
  }

  function getToken() {
    try {
      if (global.authService && typeof global.authService.getToken === 'function') {
        return String(global.authService.getToken() || '').trim();
      }
    } catch (error) {
      console.error(error);
    }

    return String(global.localStorage.getItem('bm_auth_token') || '').trim();
  }

  async function requestStorefrontState(method, body) {
    const endpoint = getStorefrontStateUrl();
    const token = getToken();

    if (!endpoint || !token) {
      return { skipped: true };
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller
      ? global.setTimeout(() => controller.abort(new Error('Storefront state request timeout')), REQUEST_TIMEOUT_MS)
      : 0;

    try {
      const response = await global.fetch(endpoint, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          Accept: 'application/json',
          Authorization: `Bearer ${token}`
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        ...(controller ? { signal: controller.signal } : {})
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        return {
          success: false,
          status: response.status,
          message: payload?.message || `Storefront state request failed with status ${response.status}`
        };
      }

      if (!payload || typeof payload !== 'object') {
        return { success: false, message: 'Storefront state API returned an invalid response.' };
      }

      return payload;
    } catch (error) {
      return {
        success: false,
        timeout: error?.name === 'AbortError',
        error,
        message: error?.name === 'AbortError'
          ? 'Storefront state request timed out.'
          : 'Unable to reach the storefront state service.'
      };
    } finally {
      if (timeoutId) {
        global.clearTimeout(timeoutId);
      }
    }
  }

  function applyRemoteState(state) {
    suppressSync = true;

    try {
      const changedFields = [];

      if (Array.isArray(state?.cartItems)) {
        stateByField.cartItems = cloneValue(state.cartItems);
        changedFields.push('cartItems');
      }

      if (Array.isArray(state?.savedItems)) {
        stateByField.savedItems = cloneValue(state.savedItems);
        changedFields.push('savedItems');
      }

      if (Object.prototype.hasOwnProperty.call(state || {}, 'directCheckout')) {
        stateByField.directCheckout = cloneValue(state.directCheckout || null);
        changedFields.push('directCheckout');
      }

      if (Object.prototype.hasOwnProperty.call(state || {}, 'checkoutDraft')) {
        stateByField.checkoutDraft = cloneValue(state.checkoutDraft || null);
        changedFields.push('checkoutDraft');
      }

      if (Object.prototype.hasOwnProperty.call(state || {}, 'checkoutConfirmation')) {
        stateByField.checkoutConfirmation = cloneValue(state.checkoutConfirmation || null);
        changedFields.push('checkoutConfirmation');
      }

      if (changedFields.length) {
        dispatchStateEvent(changedFields);
      }
    } catch (error) {
      console.warn('Unable to apply remote storefront state in memory.', error);
    } finally {
      suppressSync = false;
    }
  }

  async function syncPatch(patch) {
    if (!patch || !Object.keys(patch).length) {
      return { skipped: true };
    }

    pendingPatch = {
      ...(pendingPatch || {}),
      ...(patch || {})
    };

    syncQueue = syncQueue.then(async () => {
      const nextPatch = pendingPatch;
      pendingPatch = null;

      if (!nextPatch || !Object.keys(nextPatch).length) {
        return { skipped: true };
      }

      const payload = await requestStorefrontState('PUT', nextPatch);
      if (payload?.state) {
        applyRemoteState(payload.state);
      } else if (payload?.success === false) {
        console.warn('Unable to sync storefront state to the API.', payload.message || payload.error || payload);
      }

      return payload;
    });

    return syncQueue;
  }

  function syncStorageKey(key, value) {
    const field = STOREFRONT_KEYS[key];
    if (!field) {
      return;
    }

    applyField(field, value);
    if (!suppressSync) {
      void syncPatch({ [field]: value === undefined ? null : cloneValue(value) });
    }
  }

  async function hydrate(force = false) {
    if (hydrationPromise && !force) {
      return hydrationPromise;
    }

    hydrationPromise = requestStorefrontState('GET')
      .then((payload) => {
        if (payload?.state) {
          applyRemoteState(payload.state);
          const bootstrapPatch = buildBootstrapPatch(payload.state);
          if (Object.keys(bootstrapPatch).length && getToken()) {
            void syncPatch(bootstrapPatch);
          }
          return cloneValue(stateByField);
        }

        if (payload?.success === false) {
          console.warn('Unable to hydrate storefront state from the API.', payload.message || payload.error || payload);
        }

        const bootstrapPatch = buildBootstrapPatch(null);
        if (Object.keys(bootstrapPatch).length && getToken()) {
          void syncPatch(bootstrapPatch);
        }

        return cloneValue(stateByField);
      })
      .finally(() => {
        hydrationPromise = null;
      });

    return hydrationPromise;
  }

  global.ByoseStorefrontSync = {
    getToken,
    hydrate,
    isManagedKey: (key) => Boolean(STOREFRONT_KEYS[key]),
    readStateByKey,
    removeStateByKey,
    resolveApiOrigin,
    syncPatch,
    syncStorageKey,
    writeStateByKey
  };
})(window);
