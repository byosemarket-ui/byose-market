import { DEFAULT_ROUTE_KEY, LAST_ROUTE_STORAGE_KEY, ROUTES } from "./constants.js";

function normalizeRouteKey(routeKey) {
  const normalized = String(routeKey || "").trim().toLowerCase();
  return ROUTES[normalized] ? normalized : DEFAULT_ROUTE_KEY;
}

function routeFromHash(hash) {
  const clean = String(hash || "")
    .replace(/^#\/?/, "")
    .split("?")[0]
    .split("/")[0]
    .trim()
    .toLowerCase();

  if (!clean) {
    return "";
  }

  return normalizeRouteKey(clean);
}

function readLastRoute() {
  try {
    return normalizeRouteKey(window.localStorage.getItem(LAST_ROUTE_STORAGE_KEY) || "");
  } catch (_error) {
    return DEFAULT_ROUTE_KEY;
  }
}

function persistRoute(routeKey) {
  try {
    window.localStorage.setItem(LAST_ROUTE_STORAGE_KEY, routeKey);
  } catch (_error) {
    // Ignore storage failures.
  }
}

function setHashForRoute(routeKey) {
  const normalizedRoute = normalizeRouteKey(routeKey);
  const targetHash = `#/${normalizedRoute}`;
  const currentHash = String(window.location.hash || "");
  const currentRouteKey = normalizeRouteKey(routeFromHash(currentHash) || "");

  // Preserve query panels (e.g. #/settings?panel=profile) when already on that route.
  if (currentRouteKey === normalizedRoute && currentHash.includes("?")) {
    return;
  }

  const currentRouteHash = `#/${currentRouteKey}`;
  if (currentRouteHash !== targetHash) {
    window.location.hash = targetHash;
  }
}

export function getCurrentRoute() {
  return routeFromHash(window.location.hash);
}

export function startRouter(onRouteChange) {
  const notify = () => {
    const currentRoute = normalizeRouteKey(getCurrentRoute());
    persistRoute(currentRoute);
    onRouteChange(currentRoute);
  };

  const initialRoute = normalizeRouteKey(routeFromHash(window.location.hash || "") || readLastRoute());
  setHashForRoute(initialRoute);

  window.addEventListener("hashchange", notify);
  notify();

  return {
    navigate(routeKey) {
      setHashForRoute(routeKey);
    }
  };
}
