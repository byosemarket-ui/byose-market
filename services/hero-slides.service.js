/**
 * Storefront Hero Slides service.
 * Loads active slides from the public API backed by the Admin Hero Slider module.
 * Keeps open homepage tabs synchronized via polling, visibility, and cross-tab bumps.
 */

import { buildApiUrl } from "./api-origin.js";
import { normalizeStorefrontAssetUrl } from "./storefront-asset-url.js";

export const HERO_SLIDES_UPDATED_EVENT = "byose:hero-slides-updated";
export const HERO_SLIDES_BUMP_STORAGE_KEY = "byose_market_hero_slides_bump_v1";

const DEFAULT_TIMEOUT_MS = 12000;
const LIVE_SYNC_INTERVAL_MS = 45000;
const STALE_THRESHOLD_MS = 45000;
const REFRESH_DEBOUNCE_MS = 400;

let cachedSlides = null;
let lastSnapshotAt = 0;
let lastFingerprint = "";
let fetchInFlight = null;
let pendingForceRefresh = false;
let liveSyncStarted = false;
let liveSyncTimerId = null;
let refreshDebounceTimerId = null;
let detachLiveSyncListeners = null;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isSafeLink(value) {
  const link = normalizeText(value);
  if (!link) {
    return false;
  }

  if (/^(javascript|data|vbscript):/i.test(link)) {
    return false;
  }

  return true;
}

function resolveSlideImageUrl(slide) {
  const imageUrl = normalizeText(slide?.imageUrl);
  if (imageUrl) {
    return normalizeStorefrontAssetUrl(imageUrl);
  }

  const imagePath = normalizeText(slide?.imagePath);
  if (!imagePath) {
    return "";
  }

  if (/^(?:https?:|data:|blob:)/i.test(imagePath) || imagePath.startsWith("/")) {
    return normalizeStorefrontAssetUrl(imagePath);
  }

  return normalizeStorefrontAssetUrl(`/uploads/${imagePath.replace(/^\/+/, "")}`);
}

export function normalizeHeroSlide(slide, index = 0) {
  if (!slide || typeof slide !== "object") {
    return null;
  }

  const id = normalizeText(slide.id || slide.slideId, `hero-slide-${index + 1}`);
  const title = normalizeText(slide.title);
  const image = resolveSlideImageUrl(slide);
  const status = normalizeText(slide.status, "active").toLowerCase() === "inactive"
    ? "inactive"
    : "active";

  if (!title || !image || status !== "active") {
    return null;
  }

  const buttonLink = normalizeText(slide.buttonLink);
  const buttonText = normalizeText(slide.buttonText);
  const description = normalizeText(slide.description || slide.subtitle);

  return {
    id,
    slideId: normalizeText(slide.slideId || id),
    title,
    subtitle: description,
    description,
    buttonText,
    buttonLink: buttonText && isSafeLink(buttonLink) ? buttonLink : "",
    imageUrl: image,
    imagePath: normalizeText(slide.imagePath),
    displayOrder: toNumber(slide.displayOrder, index),
    status
  };
}

export function normalizeHeroSlides(slides) {
  return asArray(slides)
    .map((slide, index) => normalizeHeroSlide(slide, index))
    .filter(Boolean)
    .sort((left, right) => {
      if (left.displayOrder !== right.displayOrder) {
        return left.displayOrder - right.displayOrder;
      }
      return String(left.id).localeCompare(String(right.id));
    });
}

export function slidesFingerprint(slides) {
  return normalizeHeroSlides(slides)
    .map((slide) => [
      slide.id,
      slide.title,
      slide.description,
      slide.buttonText,
      slide.buttonLink,
      slide.imageUrl,
      slide.displayOrder,
      slide.status
    ].join("|"))
    .join("||");
}

function emitHeroSlidesUpdated(slides, source = "api") {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(HERO_SLIDES_UPDATED_EVENT, {
    detail: {
      slides: asArray(slides),
      fingerprint: slidesFingerprint(slides),
      syncedAt: new Date().toISOString(),
      source
    }
  }));
}

export function publishHeroSlidesBump(source = "admin") {
  if (typeof window === "undefined") {
    return;
  }

  const syncedAt = new Date().toISOString();

  try {
    if (typeof window.localStorage !== "undefined") {
      window.localStorage.setItem(HERO_SLIDES_BUMP_STORAGE_KEY, JSON.stringify({
        syncedAt,
        source,
        nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      }));
    }
  } catch (_error) {
    // Ignore storage failures.
  }

  window.dispatchEvent(new CustomEvent(HERO_SLIDES_UPDATED_EVENT, {
    detail: {
      slides: null,
      forceRefresh: true,
      syncedAt,
      source
    }
  }));
}

async function requestActiveHeroSlides(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timerId = controller
    ? window.setTimeout(() => controller.abort(), timeoutMs)
    : 0;

  try {
    const response = await fetch(buildApiUrl("hero-slides"), {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache"
      },
      signal: controller?.signal
    });

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : {};

    if (!response.ok) {
      const error = new Error(payload?.message || `Hero slides request failed (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return normalizeHeroSlides(payload?.slides);
  } finally {
    if (timerId) {
      window.clearTimeout(timerId);
    }
  }
}

function publishSlides(slides, source = "api", options = {}) {
  const normalized = normalizeHeroSlides(slides);
  const nextFingerprint = slidesFingerprint(normalized);
  const changed = nextFingerprint !== lastFingerprint;

  cachedSlides = normalized;
  lastSnapshotAt = Date.now();
  lastFingerprint = nextFingerprint;

  if (options.emit !== false && changed) {
    emitHeroSlidesUpdated(normalized, source);
  }

  return normalized.slice();
}

export function getCachedHeroSlides() {
  return Array.isArray(cachedSlides) ? cachedSlides.slice() : null;
}

export function getHeroSlidesFingerprint() {
  return lastFingerprint;
}

export function getLastHeroSnapshotAt() {
  return lastSnapshotAt;
}

export function isHeroCacheStale() {
  return !lastSnapshotAt || Date.now() - lastSnapshotAt > STALE_THRESHOLD_MS;
}

export async function getActiveHeroSlides(options = {}) {
  const force = Boolean(options.force);

  if (!force && Array.isArray(cachedSlides)) {
    return cachedSlides.slice();
  }

  if (fetchInFlight) {
    if (force) {
      pendingForceRefresh = true;
    }
    return fetchInFlight;
  }

  const runFetch = () => {
    fetchInFlight = requestActiveHeroSlides(options.timeoutMs)
      .then(async (slides) => {
        const published = publishSlides(slides, options.source || "api", { emit: options.emit !== false });
        if (pendingForceRefresh) {
          pendingForceRefresh = false;
          const again = await requestActiveHeroSlides(options.timeoutMs);
          return publishSlides(again, options.source || "api-followup", { emit: options.emit !== false });
        }
        return published;
      })
      .finally(() => {
        fetchInFlight = null;
      });
    return fetchInFlight;
  };

  return runFetch();
}

function scheduleDebouncedRefresh(source) {
  if (typeof window === "undefined") {
    return;
  }

  if (refreshDebounceTimerId) {
    window.clearTimeout(refreshDebounceTimerId);
  }

  refreshDebounceTimerId = window.setTimeout(() => {
    refreshDebounceTimerId = null;
    void getActiveHeroSlides({ force: true, emit: true, source }).catch((error) => {
      console.error(`[HeroSlides] ${source} refresh failed:`, error);
    });
  }, REFRESH_DEBOUNCE_MS);
}

function scheduleLiveSync() {
  if (typeof window === "undefined") {
    return;
  }

  if (liveSyncTimerId) {
    window.clearInterval(liveSyncTimerId);
  }

  liveSyncTimerId = window.setInterval(() => {
    if (document.visibilityState !== "visible") {
      return;
    }
    void getActiveHeroSlides({ force: true, emit: true, source: "poll" }).catch((error) => {
      console.error("[HeroSlides] Background refresh failed:", error);
    });
  }, LIVE_SYNC_INTERVAL_MS);
}

function attachLiveSyncListeners() {
  if (typeof window === "undefined") {
    return;
  }

  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible" && isHeroCacheStale()) {
      scheduleDebouncedRefresh("visibility");
    }
  };

  const handlePageShow = (event) => {
    if (event?.persisted || isHeroCacheStale()) {
      scheduleDebouncedRefresh("pageshow");
    }
  };

  const handleOnline = () => {
    scheduleDebouncedRefresh("online");
  };

  const handleStorage = (event) => {
    // Only react to explicit admin bumps — ignore sync writes that would cascade.
    if (event?.key === HERO_SLIDES_BUMP_STORAGE_KEY && event.newValue) {
      scheduleDebouncedRefresh("storage");
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("pageshow", handlePageShow);
  window.addEventListener("online", handleOnline);
  window.addEventListener("storage", handleStorage);

  detachLiveSyncListeners = () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pageshow", handlePageShow);
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("storage", handleStorage);
    if (refreshDebounceTimerId) {
      window.clearTimeout(refreshDebounceTimerId);
      refreshDebounceTimerId = null;
    }
  };
}

export function ensureHeroSlidesLiveSync() {
  if (liveSyncStarted) {
    return;
  }

  liveSyncStarted = true;
  scheduleLiveSync();
  attachLiveSyncListeners();
}

export function stopHeroSlidesLiveSync() {
  liveSyncStarted = false;

  if (liveSyncTimerId && typeof window !== "undefined") {
    window.clearInterval(liveSyncTimerId);
  }

  liveSyncTimerId = null;

  if (typeof detachLiveSyncListeners === "function") {
    detachLiveSyncListeners();
  }

  detachLiveSyncListeners = null;
}

export default {
  HERO_SLIDES_UPDATED_EVENT,
  HERO_SLIDES_BUMP_STORAGE_KEY,
  ensureHeroSlidesLiveSync,
  getActiveHeroSlides,
  getCachedHeroSlides,
  getHeroSlidesFingerprint,
  getLastHeroSnapshotAt,
  isHeroCacheStale,
  normalizeHeroSlide,
  normalizeHeroSlides,
  publishHeroSlidesBump,
  slidesFingerprint,
  stopHeroSlidesLiveSync
};
