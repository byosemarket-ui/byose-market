/**
 * Storefront shipping quote helper.
 */
(function shippingApiBootstrap(global) {
  if (!global || global.ByoseShippingApi) return;

  function resolveApiBase() {
    var base = String(global.BYOSE_API_BASE_URL || "").trim().replace(/\/+$/, "");
    if (base) return base;
    if (global.location && /^(https?:)/i.test(global.location.protocol)) {
      return String(global.location.origin || "").replace(/\/+$/, "") + "/api";
    }
    return "/api";
  }

  async function getDeliveryConfig() {
    if (global.ByoseStoreSettings?.delivery) {
      return global.ByoseStoreSettings.delivery;
    }
    const response = await fetch(resolveApiBase() + "/shipping/methods", {
      headers: { Accept: "application/json" }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
      throw new Error(payload.message || "Unable to load delivery methods");
    }
    return payload.delivery;
  }

  async function calculateShipping({ subtotal, address, method } = {}) {
    const response = await fetch(resolveApiBase() + "/shipping/calculate", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        subtotal: Number(subtotal) || 0,
        address: address || {},
        method: method || "homeDelivery"
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
      const error = new Error(payload.message || "Unable to calculate shipping");
      error.code = payload.code;
      error.details = payload.details;
      throw error;
    }
    return payload.shipping;
  }

  function resolveDefaultFee() {
    const delivery = global.ByoseStoreSettings?.delivery;
    if (!delivery) return 2000;
    if (delivery.pricing?.mode === "fixed") {
      return Number(delivery.pricing.fixedFee) || 2000;
    }
    const firstZone = Array.isArray(delivery.zones) && delivery.zones[0];
    return Number(firstZone?.fee != null ? firstZone.fee : delivery.pricing?.fixedFee) || 2000;
  }

  global.ByoseShippingApi = {
    getDeliveryConfig,
    calculateShipping,
    resolveDefaultFee
  };
})(typeof window !== "undefined" ? window : null);
