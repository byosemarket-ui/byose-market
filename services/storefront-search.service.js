(function initializeStorefrontSearch(global) {
  'use strict';

  const RECENT_SEARCHES_KEY = 'byose_market_recent_searches_v1';
  const MAX_RECENT_SEARCHES = 8;
  const DEFAULT_SEARCH_LIMIT = 60;

  function resolveApiBaseUrl() {
    const candidate = String(global.BYOSE_API_BASE_URL || '').trim().replace(/\/+$/, '');
    if (candidate) {
      return /\/api$/i.test(candidate) ? candidate : `${candidate}/api`;
    }

    const origin = String(global.location?.origin || '').replace(/\/+$/, '');
    if (origin && /byosemarket\.com$/i.test(global.location?.hostname || '')) {
      return `${origin}/api`;
    }

    return 'https://byosemarket.com/api';
  }

  function buildApiUrl(path, params) {
    const url = new URL(`${resolveApiBaseUrl()}/${String(path || '').replace(/^\/+/, '')}`);
    Object.entries(params || {}).forEach(([key, value]) => {
      const normalized = String(value ?? '').trim();
      if (normalized) {
        url.searchParams.set(key, normalized);
      }
    });
    return url.toString();
  }

  async function requestJson(path, params, options) {
    const timeoutMs = Number(options?.timeoutMs || 15000);
    const externalSignal = options?.signal || null;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? global.setTimeout(() => controller.abort(), timeoutMs) : null;
    const abortFromExternal = () => controller?.abort();

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller?.abort();
      } else if (typeof externalSignal.addEventListener === 'function') {
        externalSignal.addEventListener('abort', abortFromExternal, { once: true });
      }
    }

    try {
      const response = await fetch(buildApiUrl(path, params), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller?.signal
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload?.message || `Search request failed (${response.status})`);
        error.status = response.status;
        throw error;
      }

      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') {
        const aborted = new Error('Search request aborted');
        aborted.name = 'AbortError';
        throw aborted;
      }
      throw error;
    } finally {
      if (timeoutId) {
        global.clearTimeout(timeoutId);
      }
      if (externalSignal && typeof externalSignal.removeEventListener === 'function') {
        externalSignal.removeEventListener('abort', abortFromExternal);
      }
    }
  }

  function readRecentSearches() {
    try {
      const raw = global.localStorage.getItem(RECENT_SEARCHES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed)
        ? parsed.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, MAX_RECENT_SEARCHES)
        : [];
    } catch (_error) {
      return [];
    }
  }

  function writeRecentSearches(entries) {
    try {
      global.localStorage.setItem(
        RECENT_SEARCHES_KEY,
        JSON.stringify(Array.isArray(entries) ? entries.slice(0, MAX_RECENT_SEARCHES) : [])
      );
    } catch (_error) {
      // Ignore storage failures.
    }
  }

  function rememberRecentSearch(query) {
    const normalized = String(query || '').trim();
    if (!normalized) {
      return readRecentSearches();
    }

    const next = [normalized, ...readRecentSearches().filter((entry) => entry.toLowerCase() !== normalized.toLowerCase())];
    writeRecentSearches(next);
    return next;
  }

  function clearRecentSearches() {
    writeRecentSearches([]);
    return [];
  }

  function removeRecentSearch(query) {
    const normalized = String(query || '').trim().toLowerCase();
    if (!normalized) {
      return readRecentSearches();
    }

    const next = readRecentSearches().filter((entry) => entry.toLowerCase() !== normalized);
    writeRecentSearches(next);
    return next;
  }

  async function requestJsonPost(path, body, options) {
    const timeoutMs = Number(options?.timeoutMs || 30000);
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? global.setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const response = await fetch(`${resolveApiBaseUrl()}/${String(path || '').replace(/^\/+/, '')}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          ...(options?.headers || {})
        },
        body,
        cache: 'no-store',
        signal: controller?.signal
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload?.message || `Search request failed (${response.status})`);
        error.status = response.status;
        throw error;
      }

      return payload;
    } finally {
      if (timeoutId) {
        global.clearTimeout(timeoutId);
      }
    }
  }

  async function searchProducts(query, options) {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) {
      return {
        success: true,
        query: '',
        count: 0,
        products: [],
        relatedCategories: []
      };
    }

    const payload = await requestJson('products/search', {
      q: normalizedQuery,
      category: options?.category || '',
      limit: String(options?.limit || DEFAULT_SEARCH_LIMIT)
    }, options);

    return {
      success: Boolean(payload?.success),
      query: normalizedQuery,
      count: Number(payload?.count || (payload?.products || []).length || 0),
      products: Array.isArray(payload?.products) ? payload.products : [],
      relatedCategories: Array.isArray(payload?.relatedCategories) ? payload.relatedCategories : []
    };
  }

  async function fetchSuggestions(query, options) {
    const payload = await requestJson('products/search/suggestions', {
      q: String(query || '').trim(),
      limit: String(options?.limit || 8)
    }, options);

    return Array.isArray(payload?.suggestions) ? payload.suggestions : [];
  }

  async function fetchPopularTerms() {
    const payload = await requestJson('products/search/popular');
    return Array.isArray(payload?.terms) ? payload.terms : [];
  }

  async function searchByImage(file, options) {
    if (!file) {
      throw new Error('An image file is required for visual search.');
    }

    const formData = new FormData();
    formData.append('image', file, file.name || 'visual-search.jpg');

    const query = String(options?.query || options?.q || '').trim();
    if (query) {
      formData.append('q', query);
    }

    if (options?.analysis) {
      formData.append('analysis', JSON.stringify(options.analysis));
    }

    if (options?.limit) {
      formData.append('limit', String(options.limit));
    }

    const payload = await requestJsonPost('products/search/visual', formData, options);

    return {
      success: Boolean(payload?.success),
      query: String(payload?.query || query),
      count: Number(payload?.count || (payload?.products || []).length || 0),
      products: Array.isArray(payload?.products) ? payload.products : [],
      exactMatches: Array.isArray(payload?.exactMatches) ? payload.exactMatches : [],
      similarProducts: Array.isArray(payload?.similarProducts) ? payload.similarProducts : [],
      relatedProducts: Array.isArray(payload?.relatedProducts) ? payload.relatedProducts : [],
      relatedCategories: Array.isArray(payload?.relatedCategories) ? payload.relatedCategories : [],
      suggestedSearches: Array.isArray(payload?.suggestedSearches) ? payload.suggestedSearches : [],
      analysis: payload?.analysis || {}
    };
  }

  global.ByoseStorefrontSearch = {
    RECENT_SEARCHES_KEY,
    MAX_RECENT_SEARCHES,
    clearRecentSearches,
    fetchPopularTerms,
    fetchSuggestions,
    readRecentSearches,
    rememberRecentSearch,
    removeRecentSearch,
    resolveApiBaseUrl,
    searchByImage,
    searchProducts
  };
})(typeof window !== 'undefined' ? window : globalThis);
