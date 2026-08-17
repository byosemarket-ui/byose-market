(function bootstrapRuntimeApi(global) {
  if (!global) {
    return;
  }

  var PRODUCTION_API_BASE = "https://byosemarket.com/api";
  var LEGACY_API_PATTERN = /(?:onrender\.com|localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i;
  var STORAGE_KEYS = ["adminApiBaseUrl", "adminValidatedApiBaseUrl"];
  var LEGACY_CATALOG_KEYS = [
    "byose_market_products_catalog_v1",
    "byose_market_products_catalog_v2",
    "byose_market_products_catalog_v3"
  ];

  function normalizeApiBase(value) {
    var normalized = String(value || "").trim().replace(/\/+$/, "").replace(/\/admin$/i, "");
    if (!normalized) {
      return "";
    }

    return /\/api$/i.test(normalized) ? normalized : normalized + "/api";
  }

  function isLegacyApiBase(value) {
    return LEGACY_API_PATTERN.test(normalizeApiBase(value));
  }

  function resolveApiBaseUrl() {
    var protocol = String(global.location && global.location.protocol || "").toLowerCase();
    var hostname = String(global.location && global.location.hostname || "").trim().toLowerCase();
    var origin = String(global.location && global.location.origin || "").replace(/\/+$/, "");

    if ((protocol === "http:" || protocol === "https:") && origin) {
      // Production host and local/dev hosts must stay same-origin so checkout
      // posts orders to the API that owns the catalog/stock being viewed.
      if (/byosemarket\.com$/i.test(hostname)
        || hostname === "localhost"
        || hostname === "127.0.0.1"
        || hostname === "0.0.0.0") {
        return origin + "/api";
      }
    }

    return PRODUCTION_API_BASE;
  }

  function migrateStoredApiBase(expectedApiBase) {
    if (!expectedApiBase || typeof global.localStorage === "undefined") {
      return;
    }

    STORAGE_KEYS.forEach(function migrateKey(key) {
      try {
        var stored = normalizeApiBase(global.localStorage.getItem(key));
        if (!stored || isLegacyApiBase(stored)) {
          global.localStorage.setItem(key, expectedApiBase);
        }
      } catch (_error) {
        // Ignore storage failures.
      }
    });
  }

  var resolvedApiBase = resolveApiBaseUrl();

  if (!global.BYOSE_API_BASE_URL || isLegacyApiBase(global.BYOSE_API_BASE_URL)) {
    global.BYOSE_API_BASE_URL = resolvedApiBase;
  }

  migrateStoredApiBase(normalizeApiBase(global.BYOSE_API_BASE_URL || resolvedApiBase));

  var apiBase = normalizeApiBase(global.BYOSE_API_BASE_URL || resolvedApiBase);
  var pathName = String(global.location && global.location.pathname || "");
  var isProductDetails = /product-details/i.test(pathName);

  // Product Details: prefetch the opened product, not the full catalog.
  // Catalog prefetch on this page competes with the main product image.
  if (isProductDetails && typeof global.fetch === "function") {
    try {
      var params = new URLSearchParams(global.location && global.location.search || "");
      var productId = String(params.get("id") || params.get("product") || "").trim();
      if (productId && !global.__BYOSE_PRODUCT_PREFETCH__) {
        global.__BYOSE_PRODUCT_PREFETCH_ID__ = productId;
        global.__BYOSE_PRODUCT_PREFETCH__ = global.fetch(apiBase + "/products/" + encodeURIComponent(productId), {
          method: "GET",
          headers: { Accept: "application/json" },
          credentials: "same-origin",
          cache: "default"
        }).then(function parseProductPrefetch(response) {
          if (!response || !response.ok) {
            throw new Error("product_prefetch_http_" + (response && response.status ? response.status : "0"));
          }
          return response.json();
        }).then(function preloadMainCardImage(payload) {
          try {
            var product = payload && payload.product;
            var cardImage = product && product.cardImage ? String(product.cardImage).trim() : "";
            if (cardImage && /\/products\/cards\//i.test(cardImage) && document.head) {
              if (cardImage.charAt(0) === "/" && global.location && global.location.origin) {
                cardImage = String(global.location.origin).replace(/\/+$/, "") + cardImage;
              }
              var already = document.querySelector('link[rel="preload"][as="image"][href="' + cardImage.replace(/"/g, '\\"') + '"]');
              if (!already) {
                var preload = document.createElement("link");
                preload.rel = "preload";
                preload.as = "image";
                preload.href = cardImage;
                preload.setAttribute("fetchpriority", "high");
                document.head.appendChild(preload);
              }
            }
          } catch (_preloadError) {
            // Image preload is an optimization, not required for product data.
          }
          return payload;
        });
      }
    } catch (_error) {
      global.__BYOSE_PRODUCT_PREFETCH__ = null;
    }
  } else if (!global.__BYOSE_CATALOG_PREFETCH__ && typeof global.fetch === "function") {
    // Start the public catalog request in <head> so Home/Shop do not wait for
    // the ES-module waterfall before products can render.
    try {
      var catalogUrl = apiBase + "/products?limit=120&fields=card";
      global.__BYOSE_CATALOG_PREFETCH__ = global.fetch(catalogUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "default"
      }).then(function parseCatalogPrefetch(response) {
        if (!response || !response.ok) {
          throw new Error("catalog_prefetch_http_" + (response && response.status ? response.status : "0"));
        }
        return response.json();
      });
    } catch (_error) {
      global.__BYOSE_CATALOG_PREFETCH__ = null;
    }
  }

  if (typeof global.localStorage !== "undefined") {
    LEGACY_CATALOG_KEYS.forEach(function purgeCatalogKey(key) {
      try {
        global.localStorage.removeItem(key);
      } catch (_error) {
        // Ignore storage failures.
      }
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
