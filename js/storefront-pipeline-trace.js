/**
 * Storefront pipeline diagnostics: Database → API → Fetch → Filter → Render → DOM
 * Enable with ?debugProducts=1 or localStorage.setItem('byose_debug_products', '1')
 */

const TRACE_PREFIX = "[StorefrontPipeline]";

function isTraceEnabled() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    if (window.localStorage.getItem("byose_debug_products") === "1") {
      return true;
    }
  } catch (_error) {
    // Ignore storage failures.
  }

  try {
    return new URLSearchParams(window.location.search).get("debugProducts") === "1";
  } catch (_error) {
    return false;
  }
}

export function traceStorefrontStage(stage, payload = {}) {
  if (!isTraceEnabled()) {
    return;
  }

  const entry = {
    stage,
    at: new Date().toISOString(),
    path: typeof window !== "undefined" ? window.location.pathname : "",
    ...payload
  };

  console.info(TRACE_PREFIX, entry);

  if (typeof window !== "undefined") {
    window.__BYOSE_STOREFRONT_TRACE__ = window.__BYOSE_STOREFRONT_TRACE__ || [];
    window.__BYOSE_STOREFRONT_TRACE__.push(entry);
  }
}

export function summarizeCatalogPipeline({
  source = "unknown",
  fetched = [],
  visible = [],
  rendered = 0,
  surface = "home",
  gridId = ""
} = {}) {
  traceStorefrontStage("catalog-summary", {
    source,
    surface,
    gridId,
    fetchedCount: Array.isArray(fetched) ? fetched.length : 0,
    visibleCount: Array.isArray(visible) ? visible.length : 0,
    renderedCount: Number(rendered) || 0,
    sample: (Array.isArray(visible) ? visible : []).slice(0, 3).map((product) => ({
      id: product?.id || product?.catalogId,
      name: product?.name,
      status: product?.status,
      visibility: product?.visibility
    }))
  });
}
