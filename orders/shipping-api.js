/**
 * Storefront shipping quote helper.
 */
(function shippingApiBootstrap(global) {
  if (!global || global.ByoseShippingApi) return;

  var DEFAULT_TIMEOUT_MS = 8000;

  function resolveApiBase() {
    var base = String(global.BYOSE_API_BASE_URL || "").trim().replace(/\/+$/, "");
    if (base) return base;
    if (global.location && /^(https?:)/i.test(global.location.protocol)) {
      return String(global.location.origin || "").replace(/\/+$/, "") + "/api";
    }
    return "/api";
  }

  async function fetchJson(url, options, timeoutMs) {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () {
      try {
        controller && controller.abort();
      } catch (_error) {
        // ignore
      }
    }, Math.max(2000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));

    try {
      var response = await fetch(url, Object.assign({}, options || {}, {
        signal: controller ? controller.signal : undefined
      }));
      var payload = await response.json().catch(function () { return {}; });
      return { response: response, payload: payload };
    } finally {
      clearTimeout(timer);
    }
  }

  async function getDeliveryConfig() {
    if (global.ByoseStoreSettings && global.ByoseStoreSettings.delivery) {
      return global.ByoseStoreSettings.delivery;
    }
    var result = await fetchJson(resolveApiBase() + "/shipping/methods", {
      headers: { Accept: "application/json" }
    }, DEFAULT_TIMEOUT_MS);
    if (!result.response.ok || !result.payload.success) {
      throw new Error(result.payload.message || "Unable to load delivery methods");
    }
    return result.payload.delivery;
  }

  async function calculateShipping(input) {
    input = input || {};
    var result = await fetchJson(resolveApiBase() + "/shipping/calculate", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        subtotal: Number(input.subtotal) || 0,
        address: input.address || {},
        method: input.method || "homeDelivery"
      })
    }, DEFAULT_TIMEOUT_MS);
    if (!result.response.ok || !result.payload.success) {
      var error = new Error(result.payload.message || "Unable to calculate shipping");
      error.code = result.payload.code;
      error.details = result.payload.details;
      throw error;
    }
    return result.payload.shipping;
  }

  function resolveDefaultFee() {
    var delivery = global.ByoseStoreSettings && global.ByoseStoreSettings.delivery;
    var configured = delivery && delivery.pricing ? Number(delivery.pricing.fixedFee) : NaN;
    return Number.isFinite(configured) && configured >= 0 ? configured : 2000;
  }

  global.ByoseShippingApi = {
    getDeliveryConfig: getDeliveryConfig,
    calculateShipping: calculateShipping,
    resolveDefaultFee: resolveDefaultFee
  };
})(typeof window !== "undefined" ? window : null);
