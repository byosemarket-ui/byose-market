/**
 * STEP 3H: Centralized Product Service
 * 
 * Canonical backend-driven product management system.
 * Backend/MongoDB is the ONLY source of truth for products.
 * All storefront rendering is driven by centralized fetching and synchronization.
 */

const API_ENDPOINT = (() => {
  const base = (typeof window !== 'undefined' && window.__API_HOST__) || '/api';
  return base;
})();

const FETCH_TIMEOUT_MS = 12000;
const RETRY_COUNT = 2;
const RETRY_DELAY_MS = 400;
const SYNC_INTERVAL_MS = 35000;
const STALE_THRESHOLD_MS = 45000;
const GLOBAL_SYNC_EVENT = 'byose:products-synchronized';
const PRODUCT_CHANGED_EVENT = 'byose:products-changed';
const FALLBACK_STORAGE_KEY = 'byose_market_products_catalog_v1';

// In-memory cache (NOT canonical - only for rendering performance)
let cachedProducts = [];
let lastFetchedAt = 0;
let isFetching = false;
let fetchPromise = null;
let syncTimerId = null;

function readFallbackCatalog() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(FALLBACK_STORAGE_KEY);
    return Array.isArray(JSON.parse(raw || '[]')) ? JSON.parse(raw || '[]') : [];
  } catch (_error) {
    return [];
  }
}

function mergeProducts(primaryProducts, fallbackProducts) {
  const merged = new Map();

  normalizeProducts(primaryProducts).forEach((product) => {
    const key = String(product.id || product.catalogId || '').trim();
    if (key) {
      merged.set(key, product);
    }
  });

  normalizeProducts(fallbackProducts).forEach((product) => {
    const key = String(product.id || product.catalogId || '').trim();
    if (key) {
      merged.set(key, product);
    }
  });

  return Array.from(merged.values());
}

/**
 * Fetch products from backend API (canonical source)
 * @returns {Promise<Array>} Product array from backend
 */
export async function fetchProductsFromBackend() {
  if (isFetching && fetchPromise) {
    return fetchPromise;
  }

  isFetching = true;

  fetchPromise = (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(`${API_ENDPOINT}/products`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        signal: controller.signal,
        credentials: 'include'
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const products = Array.isArray(data?.products) ? data.products : Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      const fallbackProducts = readFallbackCatalog();

	      cachedProducts = mergeProducts(products, fallbackProducts);
      lastFetchedAt = Date.now();

      return cachedProducts;
    } catch (error) {
	      const fallbackProducts = mergeProducts([], readFallbackCatalog());
	      if (fallbackProducts.length) {
	        cachedProducts = fallbackProducts;
	        lastFetchedAt = Date.now();
	        return cachedProducts;
	      }

      console.error('[Byose Products] Backend fetch failed:', error);
      throw error;
    }
  })().finally(() => {
    isFetching = false;
    fetchPromise = null;
  });

  return fetchPromise;
}

/**
 * Get products with retry logic
 * Ensures backend is always the source of truth
 */
export async function getProductsWithRetry(retryCount = RETRY_COUNT) {
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      return await fetchProductsFromBackend();
    } catch (error) {
      if (attempt < retryCount) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      } else {
        console.error('[Byose Products] All retry attempts exhausted');
        throw error;
      }
    }
  }
}

/**
 * Get cached products (read-only, NOT canonical)
 * Cache is ONLY for rendering performance, not for ownership
 */
export function getCachedProducts() {
  return Array.isArray(cachedProducts) ? [...cachedProducts] : [];
}

/**
 * Check if cache is stale
 */
export function isCacheStale() {
  return Date.now() - lastFetchedAt > STALE_THRESHOLD_MS;
}

/**
 * Normalize and validate products from backend
 */
function normalizeProducts(products) {
  if (!Array.isArray(products)) {
    return [];
  }

  return products.map(product => ({
    ...product,
    id: product.id || product._id || product.catalogId,
    price: Number(product.price || 0),
    oldPrice: Number(product.oldPrice || 0),
    stock: Number(product.stock || 0),
    category: String(product.category || 'general').toLowerCase(),
    visibility: normalizeVisibility(product.visibility),
    priority: String(product.priority || 'normal').toLowerCase(),
    orderIndex: Number(product.orderIndex || 0),
    image: product.image || product.mainImage || '',
    gallery: Array.isArray(product.gallery) ? product.gallery : []
  })).filter(p => p.name && p.price >= 0);
}

function normalizeVisibility(value) {
  const normalized = String(value || 'both').toLowerCase();
  return ['home', 'shop', 'both'].includes(normalized) ? normalized : 'both';
}

/**
 * Publish global product synchronization event
 */
function publishProductSync(products) {
  if (typeof window !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent(GLOBAL_SYNC_EVENT, {
      detail: {
        products: Array.isArray(products) ? products : [],
        syncedAt: new Date().toISOString(),
        source: 'backend'
      }
    }));
  }
}

/**
 * Initialize background synchronization timer
 * Ensures products stay fresh without manual intervention
 */
export function startBackgroundSync() {
  if (syncTimerId) {
    return;
  }

  const performSync = async () => {
    try {
      const products = await fetchProductsFromBackend();
      publishProductSync(products);
    } catch (error) {
      console.warn('[Byose Products] Background sync failed:', error);
    }
  };

  // Perform initial sync immediately
  performSync();

  // Then schedule periodic syncs
  syncTimerId = setInterval(performSync, SYNC_INTERVAL_MS);
}

/**
 * Stop background synchronization
 */
export function stopBackgroundSync() {
  if (syncTimerId) {
    clearInterval(syncTimerId);
    syncTimerId = null;
  }
}

/**
 * Force refresh from backend (bypass cache)
 */
export async function forceRefreshProducts() {
  cachedProducts = [];
  lastFetchedAt = 0;
  const products = await getProductsWithRetry();
  publishProductSync(products);
  return products;
}

/**
 * Handle admin product updates
 * Triggered when admin creates/updates/deletes products
 */
export async function handleAdminProductUpdate() {
  await forceRefreshProducts();
}

// Initialize synchronization on module load if in browser environment
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    startBackgroundSync();
  });

  window.addEventListener('storage', (event) => {
    if (event?.key && event.key !== FALLBACK_STORAGE_KEY) {
      return;
    }

    cachedProducts = mergeProducts(cachedProducts, readFallbackCatalog());
    publishProductSync(cachedProducts);
  });

  window.addEventListener(PRODUCT_CHANGED_EVENT, () => {
    cachedProducts = mergeProducts(cachedProducts, readFallbackCatalog());
    publishProductSync(cachedProducts);
  });

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    stopBackgroundSync();
  });
}

export default {
  fetchProductsFromBackend,
  getProductsWithRetry,
  getCachedProducts,
  isCacheStale,
  startBackgroundSync,
  stopBackgroundSync,
  forceRefreshProducts,
  handleAdminProductUpdate,
  GLOBAL_SYNC_EVENT,
  PRODUCT_CHANGED_EVENT
};
