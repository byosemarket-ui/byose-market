/**
 * Applies branding colors/logos across the Admin Dashboard shell.
 */
function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function assetUrl(entry, fallback = "") {
  if (!entry) return fallback;
  if (typeof entry === "string") return entry || fallback;
  return String(entry.url || entry.path || fallback || "");
}

export function applyAdminBranding(branding) {
  if (typeof document === "undefined") return;
  const safe = asObject(branding);
  const colors = asObject(safe.colors);
  const logos = asObject(safe.logos);
  const identity = asObject(safe.identity);
  const root = document.documentElement;

  const map = {
    "--app-primary": colors.primary,
    "--app-primary-strong": colors.primary,
    "--app-accent": colors.accent,
    "--app-success": colors.success,
    "--app-warning": colors.warning,
    "--app-danger": colors.error,
    "--app-text": colors.text,
    "--app-muted": colors.textMuted,
    "--app-surface": colors.background,
    "--app-surface-alt": colors.backgroundAlt
  };

  Object.entries(map).forEach(([key, value]) => {
    if (value) {
      root.style.setProperty(key, String(value));
    }
  });

  const adminLogo = assetUrl(logos.adminLogo) || assetUrl(logos.mainLogo) || assetUrl(logos.darkLogo);
  const mark = document.querySelector(".sidebar-brand-mark");
  if (mark && adminLogo) {
    mark.innerHTML = `<img src="${adminLogo.replace(/"/g, "&quot;")}" alt="Admin logo" />`;
  }

  const brandTitle = document.querySelector(".sidebar-brand-copy h1");
  if (brandTitle && identity.slogan) {
    brandTitle.setAttribute("title", identity.slogan);
  }

  const brandSummary = document.querySelector(".sidebar-brand-copy .brand-summary");
  if (brandSummary && identity.tagline) {
    brandSummary.textContent = identity.tagline;
  }

  const favicon = assetUrl(asObject(safe.icons).favicon) || assetUrl(asObject(safe.icons).browserTabIcon);
  if (favicon) {
    let link = document.querySelector('link[rel="icon"][data-branding-favicon]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      link.setAttribute("data-branding-favicon", "true");
      document.head.appendChild(link);
    }
    link.href = favicon;
  }
}

export async function loadAndApplyAdminBranding(fetcher) {
  try {
    const branding = typeof fetcher === "function" ? await fetcher() : null;
    if (branding) {
      applyAdminBranding(branding);
    }
    return branding;
  } catch (_error) {
    return null;
  }
}
