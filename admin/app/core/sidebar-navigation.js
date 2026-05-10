import { DEFAULT_ROUTE_KEY, ROUTES } from "./constants.js";

const EXPANDED_BRANCH_STORAGE_KEY = "byose_admin_sidebar_expanded_v1";

function normalizeRouteKey(routeKey) {
  const normalized = String(routeKey || "").trim().toLowerCase();
  return ROUTES[normalized] ? normalized : "";
}

function normalizeHash(hash) {
  const normalized = String(hash || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  return normalized.startsWith("#") ? normalized : `#${normalized}`;
}

function routeFromHash(hash) {
  const clean = String(hash || "")
    .replace(/^#\/?/, "")
    .split("?")[0]
    .split("/")[0]
    .trim()
    .toLowerCase();

  return normalizeRouteKey(clean);
}

function normalizeAdminPath(pathname) {
  const normalized = String(pathname || "").replace(/\\/g, "/").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  const adminIndex = normalized.indexOf("/admin/");
  const relative = adminIndex >= 0 ? normalized.slice(adminIndex + 7) : normalized;
  return relative.replace(/^\/+/, "");
}

function getAdminBasePath() {
  const pathname = String(window.location.pathname || "").replace(/\\/g, "/");
  const marker = "/admin/";
  const markerIndex = pathname.toLowerCase().indexOf(marker);

  if (markerIndex >= 0) {
    return pathname.slice(0, markerIndex + marker.length);
  }

  const segments = pathname.split("/");
  segments.pop();

  while (segments.length && segments[segments.length - 1].toLowerCase() !== "admin") {
    segments.pop();
  }

  if (segments.length && segments[segments.length - 1].toLowerCase() === "admin") {
    return `${segments.join("/")}/`;
  }

  return "/admin/";
}

function normalizeMatchPath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  if (normalized.startsWith("#") || normalized.startsWith("?")) {
    return "";
  }

  if (/^(?:[a-z]+:)?\/\//i.test(normalized)) {
    try {
      return normalizeAdminPath(new URL(normalized).pathname);
    } catch (_error) {
      return "";
    }
  }

  const adminRelative = normalized.includes("/admin/") ? normalized.split("/admin/").pop() : normalized;
  return adminRelative.replace(/^\/+/, "").replace(/^admin\//, "");
}

export function resolveAdminHref(href) {
  const value = String(href || "").trim();
  if (!value) {
    return "#";
  }

  if (/^(?:[a-z]+:|#|\?)/i.test(value)) {
    return value;
  }

  if (value.startsWith("/")) {
    return value;
  }

  return `${getAdminBasePath()}${value.replace(/^\.\//, "")}`;
}

export function getNavigationLocation(routeKey = "") {
  const normalizedRoute = normalizeRouteKey(routeKey) || routeFromHash(window.location.hash) || DEFAULT_ROUTE_KEY;
  return {
    routeKey: normalizedRoute,
    hash: normalizeHash(window.location.hash) || `#/${normalizedRoute}`,
    pathname: normalizeAdminPath(window.location.pathname)
  };
}

export function matchesNavigationEntry(entry, location) {
  const matchHashes = Array.isArray(entry?.matchHashes)
    ? entry.matchHashes.map(normalizeHash).filter(Boolean)
    : [];
  const matchPaths = Array.isArray(entry?.matchPaths)
    ? entry.matchPaths.map(normalizeMatchPath).filter(Boolean)
    : [];
  const matchRoutes = Array.isArray(entry?.matchRoutes)
    ? entry.matchRoutes.map(normalizeRouteKey).filter(Boolean)
    : [];

  if (matchHashes.length && matchHashes.includes(location.hash)) {
    return true;
  }

  if (matchPaths.length && matchPaths.includes(location.pathname)) {
    return true;
  }

  if (matchRoutes.length && matchRoutes.includes(location.routeKey) && !matchHashes.length) {
    return true;
  }

  if (entry?.href) {
    if (String(entry.href).trim().startsWith("#")) {
      return normalizeHash(entry.href) === location.hash;
    }

    return normalizeMatchPath(entry.href) === location.pathname;
  }

  return false;
}

export function collectActiveTrail(navigation, location) {
  const activeBranchIds = new Set();
  const activeItemIds = new Set();

  function visit(entries, ancestors = []) {
    let containsActiveEntry = false;

    entries.forEach((entry) => {
      const childEntries = Array.isArray(entry.children) ? entry.children : [];
      const childIsActive = childEntries.length ? visit(childEntries, [...ancestors, entry.id]) : false;
      const selfIsActive = matchesNavigationEntry(entry, location);
      const entryIsActive = selfIsActive || childIsActive;

      if (!entryIsActive) {
        return;
      }

      containsActiveEntry = true;
      ancestors.forEach((ancestorId) => activeBranchIds.add(ancestorId));

      if (childEntries.length) {
        activeBranchIds.add(entry.id);
      }

      activeItemIds.add(entry.id);
    });

    return containsActiveEntry;
  }

  navigation.forEach((group) => {
    visit(group.items || []);
  });

  return { activeBranchIds, activeItemIds };
}

export function resolveNavigationContext(navigation, routeKey = "") {
  const location = typeof routeKey === "string" ? getNavigationLocation(routeKey) : routeKey;
  const normalizedLocation = location || getNavigationLocation("");
  const baseRoutePath = normalizeHash(ROUTES[normalizedLocation.routeKey]?.path || `#/${DEFAULT_ROUTE_KEY}`);
  const fallback = {
    group: null,
    routeItem: null,
    activeEntry: null
  };

  function visit(entries, group, ancestors = []) {
    for (const entry of entries || []) {
      const trail = [...ancestors, entry];
      const childEntries = Array.isArray(entry.children) ? entry.children : [];
      const entryMatches = matchesNavigationEntry(entry, normalizedLocation);

      if (entry.routeKey === normalizedLocation.routeKey && !fallback.routeItem) {
        fallback.group = group;
        fallback.routeItem = entry;
      }

      if (childEntries.length) {
        const childMatch = visit(childEntries, group, trail);
        if (childMatch) {
          return childMatch;
        }
      }

      if (entryMatches) {
        return {
          group,
          routeItem: trail.find((node) => node.routeKey === normalizedLocation.routeKey) || entry,
          activeEntry: entry
        };
      }
    }

    return null;
  }

  for (const group of navigation || []) {
    const matched = visit(group.items || [], group, []);
    if (matched) {
      const activeHref = normalizeHash(matched.activeEntry?.href || "");
      const isDefaultRouteDestination = Boolean(activeHref && activeHref === baseRoutePath);
      const routeLabel = ROUTES[normalizedLocation.routeKey]?.label || matched.routeItem?.label || "Dashboard";
      const contextualTitle = matched.activeEntry && !isDefaultRouteDestination
        ? matched.activeEntry.label || routeLabel
        : routeLabel;

      return {
        group: matched.group?.label || ROUTE_LABEL_FALLBACK.group,
        section: matched.routeItem?.label || routeLabel,
        title: contextualTitle,
        badge: matched.activeEntry?.label || matched.routeItem?.label || routeLabel,
        description: matched.activeEntry?.description || matched.routeItem?.description || ROUTE_LABEL_FALLBACK.description
      };
    }
  }

  const fallbackRouteLabel = ROUTES[normalizedLocation.routeKey]?.label || "Dashboard";
  return {
    group: fallback.group?.label || ROUTE_LABEL_FALLBACK.group,
    section: fallback.routeItem?.label || fallbackRouteLabel,
    title: fallbackRouteLabel,
    badge: fallback.routeItem?.label || fallbackRouteLabel,
    description: fallback.routeItem?.description || ROUTE_LABEL_FALLBACK.description
  };
}

const ROUTE_LABEL_FALLBACK = {
  group: "Operations",
  description: "Central snapshot and storefront health"
};

export function readExpandedBranchIds() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(EXPANDED_BRANCH_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw.map((value) => String(value || "").trim()).filter(Boolean) : []);
  } catch (_error) {
    return new Set();
  }
}

export function persistExpandedBranchIds(ids) {
  try {
    const values = Array.from(ids || []).map((value) => String(value || "").trim()).filter(Boolean);
    window.localStorage.setItem(EXPANDED_BRANCH_STORAGE_KEY, JSON.stringify(values));
  } catch (_error) {
    // Ignore storage failures.
  }
}