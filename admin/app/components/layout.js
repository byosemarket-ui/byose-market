import { ADMIN_NAVIGATION, ROUTE_METADATA } from "../core/navigation.js";
import { logout } from "../core/auth.js";
import {
  collectActiveTrail,
  flattenNavigationDestinations,
  getNavigationLocation,
  persistExpandedBranchIds,
  readExpandedBranchIds,
  resolveAdminHref,
  resolveNavigationContext
} from "../core/sidebar-navigation.js";
import { modalTemplate } from "./ui.js";
import { getNotificationCenter, getNotificationSettings, markAllNotificationsRead, markNotificationRead } from "../services/admin-data.service.js";
import { startRealtimeSync, subscribeToRealtimeEvents } from "../services/realtime-sync.service.js";
import {
  announceIncomingNotification,
  areNotificationPrefsReady,
  setCachedNotificationPrefs
} from "../utils/notification-prefs.js";

const HEADER_QUICK_ACTIONS = [
  { id: "quick-orders", label: "Open Orders", href: "#/orders", detail: "Fulfillment and status operations" },
  { id: "quick-products", label: "Add Product", href: "#/products?view=create&step=info", detail: "Create a new catalog item" },
  { id: "quick-settings", label: "Admin Settings", href: "#/settings?panel=notifications", detail: "Notification and access controls" }
];

const PAGE_SEARCH_SELECTORS = [
  "#ordersSearch",
  "#customersSearch",
  "#enterpriseSearchInput",
  "[data-hs-search]",
  "#loginHistorySearch"
];

let headerNotificationsState = {
  unreadCount: 0,
  items: [],
  loading: false
};

let headerNotificationsRealtimeBound = false;
let headerNotificationsRefreshTimer = null;
let headerSearchIndex = [];

function scheduleHeaderNotificationsRefresh(delayMs = 180) {
  if (headerNotificationsRefreshTimer) {
    window.clearTimeout(headerNotificationsRefreshTimer);
  }
  headerNotificationsRefreshTimer = window.setTimeout(() => {
    headerNotificationsRefreshTimer = null;
    void refreshHeaderNotifications({ force: true });
  }, Math.max(50, Number(delayMs) || 180));
}

function bindHeaderNotificationsRealtime() {
  if (headerNotificationsRealtimeBound) return;
  headerNotificationsRealtimeBound = true;

  void startRealtimeSync().catch((error) => {
    console.warn("[Notifications] Realtime sync unavailable:", error?.message || error);
  });

  subscribeToRealtimeEvents("notifications", (event) => {
    const type = String(event?.type || "");
    if (!type.startsWith("notification:")) return;

    const payload = event?.payload || {};
    const notification = payload.notification;
    if (type === "notification:created" && notification && typeof notification === "object") {
      if (notification?.metadata?.silent || notification?.metadata?.inAppChannelDisabled) {
        scheduleHeaderNotificationsRefresh(1200);
        return;
      }
      const nextItems = [
        notification,
        ...headerNotificationsState.items.filter((item) => String(item?.id) !== String(notification.id))
      ].slice(0, 8);
      headerNotificationsState.items = nextItems;
      const delta = Number(payload.unreadDelta);
      if (Number.isFinite(delta) && delta !== 0) {
        headerNotificationsState.unreadCount = Math.max(0, Number(headerNotificationsState.unreadCount || 0) + delta);
      } else if (String(notification.status || "").toLowerCase() === "unread") {
        headerNotificationsState.unreadCount = Math.max(0, Number(headerNotificationsState.unreadCount || 0) + 1);
      }
      syncHeaderNotificationBadge();
      const body = document.querySelector("#headerNotificationsPanel .header-panel-body");
      if (body) {
        body.innerHTML = renderHeaderNotificationsPanelBody();
      }
      if (areNotificationPrefsReady()) {
        announceIncomingNotification(notification);
      }
      scheduleHeaderNotificationsRefresh(1500);
      return;
    }

    scheduleHeaderNotificationsRefresh(400);
  });
}

function iconSvg(iconName) {
  const iconMap = {
    grid: "M3 3h8v8H3V3Zm10 0h8v5h-8V3ZM3 13h5v8H3v-8Zm7 4h11v4H10v-4Z",
    cart: "M3 4h2l1.5 9h10L19 7H7M9 20a1 1 0 1 0 0 .01M17 20a1 1 0 1 0 0 .01",
    users: "M7 20v-1c0-2 2-4 5-4s5 2 5 4v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
    box: "M4 7 12 3l8 4-8 4-8-4Zm0 0v10l8 4 8-4V7",
    chart: "M4 18h16M7 14v-3m5 3V8m5 6v-5",
    layers: "m12 3 9 4-9 4-9-4 9-4Zm0 8 9 4-9 4-9-4 9-4",
    activity: "M3 12h4l2-5 4 10 2-5h6",
    settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
    enterprise: "M4 5h16v14H4zM4 9h16M9 5v14M15 5v14",
    website: "M4 5h16v14H4V5Zm0 4h16M9 19V9",
    messages: "M4 7h16v10H4V7Zm0 0 8 6 8-6"
  };

  return iconMap[iconName] || iconMap.grid;
}

function navDestination(item, depth) {
  const destinationClass = depth > 1 ? "nav-sublink nav-sublink-nested" : "nav-sublink";
  const title = item.description ? `${item.label} — ${item.description}` : item.label;

  if (item.action === "logout") {
    return `
      <button class="${destinationClass} nav-sublink-action" type="button" data-admin-logout data-nav-destination-id="${item.id}" title="${escapeHeaderText(title)}">
        <span class="nav-sublink-dot" aria-hidden="true"></span>
        <span class="nav-sublink-copy">${escapeHeaderText(item.label)}</span>
      </button>
    `;
  }

  return `
    <a class="${destinationClass}" data-nav-destination-id="${item.id}" href="${resolveAdminHref(item.href)}" title="${escapeHeaderText(title)}">
      <span class="nav-sublink-dot" aria-hidden="true"></span>
      <span class="nav-sublink-copy">${escapeHeaderText(item.label)}</span>
    </a>
  `;
}

function navBranch(item, depth = 0) {
  const childEntries = Array.isArray(item.children) ? item.children : [];
  if (!childEntries.length) {
    return navDestination(item, depth);
  }

  const title = item.description ? `${item.label} — ${item.description}` : item.label;
  const iconMarkup = depth === 0
    ? `
      <span class="nav-branch-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="${iconSvg(item.icon)}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
      </span>
    `
    : `<span class="nav-branch-bullet" aria-hidden="true"></span>`;

  return `
    <section class="nav-branch nav-depth-${depth}" data-nav-branch data-branch-id="${item.id}">
      <button class="nav-branch-trigger" type="button" data-nav-branch-trigger aria-expanded="false" aria-controls="nav-panel-${item.id}" title="${escapeHeaderText(title)}" aria-label="${escapeHeaderText(item.label)}">
        ${iconMarkup}
        <span class="nav-branch-copy">${escapeHeaderText(item.label)}</span>
        <span class="nav-branch-chevron" aria-hidden="true"></span>
      </button>
      <div class="nav-branch-panel" id="nav-panel-${item.id}" data-nav-branch-panel aria-hidden="true">
        <div class="nav-branch-panel-inner">
          <div class="nav-submenu">
            ${childEntries.map((child) => navBranch(child, depth + 1)).join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

function navGroup(group) {
  return `
    <section class="nav-group" aria-label="${escapeHeaderText(group.label)}">
      <div class="nav-group-header">
        <span class="nav-group-title">${escapeHeaderText(group.label)}</span>
      </div>
      <div class="nav-group-items">
        ${group.items.map((item) => navBranch(item)).join("")}
      </div>
    </section>
  `;
}

function utilityIconSvg(iconName) {
  const iconMap = {
    search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 0 9 9",
    bell: "M15 17H5l1.2-1.6a3 3 0 0 0 .6-1.8V10a5.2 5.2 0 1 1 10.4 0v3.6c0 .66.22 1.3.62 1.82L19 17h-4Zm-3 4a2.5 2.5 0 0 0 2.35-1.67",
    spark: "M12 3v5m0 8v5m9-9h-5M8 12H3m15.36-6.36-3.54 3.54M8.18 15.82l-3.54 3.54m0-13.72 3.54 3.54m7.64 7.64 3.54 3.54",
    settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8 4 .94 1.77-1.68 2.9-2.02-.37a7.94 7.94 0 0 1-1.52.88l-.29 2.03H8.57l-.29-2.03a7.94 7.94 0 0 1-1.52-.88l-2.02.37-1.68-2.9L4 12l-.94-1.77 1.68-2.9 2.02.37c.47-.36.98-.65 1.52-.88L8.57 4.8h6.86l.29 2.03c.54.23 1.05.52 1.52.88l2.02-.37 1.68 2.9L20 12Z",
    chevron: "M9 6l6 6-6 6",
    shield: "M12 3l7 3v5c0 4.4-3 8.2-7 10-4-1.8-7-5.6-7-10V6l7-3Z",
    logout: "M15 8l4 4-4 4M19 12H9M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5"
  };

  return iconMap[iconName] || iconMap.search;
}

function formatAdminRole(role) {
  const value = String(role || "admin").trim();
  if (!value) return "Administrator";
  const mapped = {
    admin: "Administrator",
    super_admin: "Super Administrator",
    superadmin: "Super Administrator",
    owner: "Owner"
  };
  const key = value.toLowerCase().replace(/\s+/g, "_");
  if (mapped[key]) return mapped[key];
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function readAdminSessionProfile() {
  try {
    const snapshot = window.AdminSecurity && typeof window.AdminSecurity.getSessionSnapshot === "function"
      ? window.AdminSecurity.getSessionSnapshot()
      : null;
    const profile = snapshot && snapshot.profile && typeof snapshot.profile === "object" ? snapshot.profile : null;
    const email = String(profile?.email || snapshot?.email || "").trim();
    const fullName = String(profile?.name || "").trim();
    const emailName = email.includes("@") ? email.split("@")[0] : "";
    const firstName = String(profile?.firstName || fullName.split(/\s+/)[0] || emailName || "Administrator").trim() || "Administrator";
    const lastName = String(
      profile?.lastName
      || (fullName.includes(" ") ? fullName.split(/\s+/).slice(1).join(" ") : "")
    ).trim();
    const role = String(profile?.role || "admin").trim() || "admin";
    const avatarUrl = String(profile?.avatarUrl || "").trim();
    const avatar = String(profile?.avatar || "").trim();
    const resolvedAvatar = avatarUrl
      || (avatar
        ? (/^https?:\/\//i.test(avatar) || avatar.startsWith("/") ? avatar : `/uploads/${avatar.replace(/^\/+/, "")}`)
        : "");
    const resolvedName = fullName || [firstName, lastName].filter(Boolean).join(" ") || email || "Administrator";
    const initialsSource = `${firstName.charAt(0)}${(lastName || emailName || "A").charAt(0)}`;

    return {
      fullName: resolvedName,
      email,
      role,
      roleLabel: formatAdminRole(role),
      avatarUrl: resolvedAvatar,
      initials: initialsSource.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "AD"
    };
  } catch (_error) {
    return {
      fullName: "Administrator",
      email: "",
      role: "admin",
      roleLabel: "Administrator",
      avatarUrl: "",
      initials: "AD"
    };
  }
}

function readAdminSessionStatus() {
  const security = window.AdminSecurity;
  const snapshot = security && typeof security.getSessionSnapshot === "function"
    ? security.getSessionSnapshot()
    : null;
  const authenticated = Boolean(
    (security && typeof security.isAuthenticated === "function" && security.isAuthenticated())
    || snapshot?.authenticated
  );
  const hasToken = Boolean(String(snapshot?.token || "").trim());
  const jwtProtected = authenticated && hasToken;
  const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;

  return {
    authenticated,
    jwtProtected,
    online,
    label: jwtProtected ? "Secure session" : (authenticated ? "Session active" : "Session unavailable"),
    detail: jwtProtected ? "JWT validation active" : (authenticated ? "Token not available" : "Sign-in required")
  };
}

function avatarMarkup(profile, extraClass = "") {
  if (profile.avatarUrl) {
    return `<img src="${escapeHeaderText(profile.avatarUrl)}" alt="" />`;
  }
  return `<span class="${extraClass}">${escapeHeaderText(profile.initials)}</span>`;
}

function escapeHeaderText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatHeaderTime(value) {
  const date = new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString();
}

function notificationItemsMarkup(items = headerNotificationsState.items) {
  if (!items.length) {
    return `<div class="header-notifications-empty">No notifications yet.</div>`;
  }

  return items.map((item) => {
    const unread = String(item.status || "").toLowerCase() === "unread";
    const icon = String(item?.metadata?.icon || item.type || "system").toLowerCase();
    return `
      <button type="button" class="header-notification-item${unread ? " is-unread" : ""}" data-header-notification-id="${escapeHeaderText(item.id)}" data-notification-type="${escapeHeaderText(item.type || "system")}" data-notification-icon="${escapeHeaderText(icon)}">
        <strong>${escapeHeaderText(item.title || "Notification")}</strong>
        <p>${escapeHeaderText(item.message || "")}</p>
        <small>${escapeHeaderText(item.type || "system")} · ${escapeHeaderText(formatHeaderTime(item.createdAt))}</small>
      </button>
    `;
  }).join("");
}

function renderHeaderNotificationsPanelBody() {
  return `
    ${notificationItemsMarkup()}
    <div class="header-notifications-footer">
      <button type="button" class="btn btn-ghost" data-header-notifications-action="mark-all">Mark all read</button>
      <a class="btn btn-primary" href="#/notifications">View all notifications</a>
    </div>
  `;
}

function syncHeaderNotificationBadge() {
  const badge = document.querySelector('[data-header-panel-toggle="notifications"] .header-utility-badge');
  const panelBadge = document.querySelector("#headerNotificationsPanel .header-panel-badge");
  const count = Number(headerNotificationsState.unreadCount || 0);
  if (badge) {
    badge.textContent = String(count);
    badge.hidden = count <= 0;
  }
  if (panelBadge) {
    panelBadge.textContent = count ? `${count} unread` : "All caught up";
  }
}

function syncSessionStatusChrome() {
  const status = readAdminSessionStatus();
  const headerStatus = document.getElementById("headerSessionStatus");
  const headerStatusLabel = document.getElementById("headerSessionLabel");
  const sidebarStatus = document.getElementById("sidebarSessionStatus");
  const sidebarDetail = document.getElementById("sidebarSessionDetail");
  const sidebarLabel = document.getElementById("sidebarSessionLabel");
  const profileStatus = document.getElementById("sidebarProfileStatus");

  headerStatus?.classList.toggle("is-secure", status.jwtProtected);
  headerStatus?.classList.toggle("is-offline", !status.online);
  if (headerStatusLabel) {
    headerStatusLabel.textContent = status.online ? status.label : "Offline";
  }

  sidebarStatus?.classList.toggle("is-secure", status.jwtProtected);
  sidebarStatus?.classList.toggle("is-offline", !status.online);
  if (sidebarLabel) sidebarLabel.textContent = status.label;
  if (sidebarDetail) sidebarDetail.textContent = status.detail;

  profileStatus?.classList.toggle("is-online", status.online && status.authenticated);
  profileStatus?.setAttribute("title", status.online && status.authenticated ? "Online" : "Offline");
  profileStatus?.setAttribute("aria-label", status.online && status.authenticated ? "Online" : "Offline");
}

async function refreshHeaderNotifications(options = {}) {
  const body = document.querySelector("#headerNotificationsPanel .header-panel-body");
  if (headerNotificationsState.loading && !options.force) return;
  headerNotificationsState.loading = true;
  try {
    const center = await getNotificationCenter({ force: true, limit: 8 });
    headerNotificationsState.unreadCount = Number(center.unreadCount || 0);
    headerNotificationsState.items = Array.isArray(center.notifications)
      ? center.notifications.filter((item) => !(item?.metadata?.silent || item?.metadata?.inAppChannelDisabled))
      : [];
    if (center.settings && typeof center.settings === "object") {
      setCachedNotificationPrefs(center.settings);
    } else if (!areNotificationPrefsReady()) {
      try {
        const settings = await getNotificationSettings();
        setCachedNotificationPrefs(settings);
      } catch (_prefsError) {
        // keep defaults until settings page loads
      }
    }
    syncHeaderNotificationBadge();
    if (body) {
      body.innerHTML = renderHeaderNotificationsPanelBody();
    }
  } catch (error) {
    console.error(error);
    if (!areNotificationPrefsReady()) {
      try {
        const settings = await getNotificationSettings();
        setCachedNotificationPrefs(settings);
      } catch (_prefsError) {
        // ignore
      }
    }
    if (body && !headerNotificationsState.items.length) {
      body.innerHTML = `<div class="header-notifications-empty">Unable to load notifications right now.</div>`;
    }
  } finally {
    headerNotificationsState.loading = false;
  }
}

function quickActionItemsMarkup() {
  return HEADER_QUICK_ACTIONS.map((item) => `
    <a class="header-panel-link" href="${item.href}">
      <span class="header-panel-link-copy">
        <strong>${item.label}</strong>
        <small>${item.detail}</small>
      </span>
      <span class="header-panel-link-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="${utilityIconSvg("chevron")}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
      </span>
    </a>
  `).join("");
}

function applyProfileToChrome(profile) {
  const nameNodes = ["headerProfileName", "headerProfilePanelDetail", "sidebarProfileName"];
  const roleNodes = ["headerProfileRole", "sidebarProfileRole"];
  const emailNode = document.getElementById("headerProfileEmailDetail");
  const avatars = ["headerProfileAvatar", "headerProfileAvatarLarge", "sidebarProfileAvatar"];

  nameNodes.forEach((id) => {
    const node = document.getElementById(id);
    if (node) node.textContent = profile.fullName;
  });
  roleNodes.forEach((id) => {
    const node = document.getElementById(id);
    if (node) node.textContent = profile.roleLabel;
  });
  if (emailNode) {
    emailNode.textContent = profile.email;
    emailNode.hidden = !profile.email;
  }

  const safeAvatarUrl = String(profile.avatarUrl || "").replace(/"/g, "");
  const avatarHtml = safeAvatarUrl
    ? `<img src="${safeAvatarUrl}${safeAvatarUrl.includes("?") ? "&" : "?"}v=${Date.now()}" alt="" />`
    : escapeHeaderText(profile.initials);
  avatars.forEach((id) => {
    const node = document.getElementById(id);
    if (node) node.innerHTML = avatarHtml;
  });
}

function filterSearchDestinations(query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return [];
  return headerSearchIndex.filter((item) => {
    const haystack = `${item.label} ${item.parent} ${item.group} ${item.description}`.toLowerCase();
    return haystack.includes(needle);
  }).slice(0, 8);
}

function renderSearchResults(query) {
  const list = document.getElementById("adminShellSearchResults");
  if (!list) return [];
  const matches = filterSearchDestinations(query);
  if (!String(query || "").trim()) {
    list.hidden = true;
    list.innerHTML = "";
    return [];
  }

  if (!matches.length) {
    list.hidden = false;
    list.innerHTML = `<div class="header-search-empty">No matching admin pages. Press Enter to search records.</div>`;
    return [];
  }

  list.hidden = false;
  list.innerHTML = matches.map((item, index) => `
    <a class="header-search-result${index === 0 ? " is-active" : ""}" href="${resolveAdminHref(item.href)}" data-search-index="${index}">
      <strong>${escapeHeaderText(item.label)}</strong>
      <small>${escapeHeaderText([item.parent, item.group].filter(Boolean).join(" · "))}</small>
    </a>
  `).join("");
  return matches;
}

function closeSearchResults() {
  const list = document.getElementById("adminShellSearchResults");
  if (!list) return;
  list.hidden = true;
}

function applyQueryToPageSearch(query) {
  const field = PAGE_SEARCH_SELECTORS
    .map((selector) => document.querySelector(selector))
    .find(Boolean);
  if (!field) return false;
  field.value = query;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.focus();
  return true;
}

function submitAdminSearch(query, matches = []) {
  const value = String(query || "").trim();
  closeSearchResults();
  if (!value) return;

  const activeResult = document.querySelector(".header-search-result.is-active");
  if (activeResult) {
    const href = String(activeResult.getAttribute("href") || "").trim();
    if (href.startsWith("#")) {
      window.location.hash = href;
    } else if (href) {
      window.location.href = href;
    }
    return;
  }

  if (matches[0]?.href) {
    const href = resolveAdminHref(matches[0].href);
    if (href.startsWith("#")) {
      window.location.hash = href;
    } else {
      window.location.href = href;
    }
    return;
  }

  if (applyQueryToPageSearch(value)) {
    return;
  }

  window.location.hash = `#/enterprise?q=${encodeURIComponent(value)}`;
}

export function renderAppShell(rootElement) {
  const adminProfile = readAdminSessionProfile();
  const sessionStatus = readAdminSessionStatus();
  headerSearchIndex = flattenNavigationDestinations(ADMIN_NAVIGATION);

  rootElement.innerHTML = `
    <a class="skip-link" href="#appPageContent">Skip to dashboard content</a>
    <div class="admin-app" id="adminAppShell" data-layout="byose-admin">
      <div class="admin-sidebar-backdrop" id="adminSidebarBackdrop" hidden></div>
      <aside class="admin-sidebar" id="adminSidebar" aria-label="Primary admin sidebar">
        <div class="admin-sidebar-inner">
          <div class="sidebar-brand">
            <a class="sidebar-brand-panel" href="#/dashboard" aria-label="BYOSE Market Admin">
              <div class="sidebar-brand-mark" aria-hidden="true"><span>BM</span></div>
              <div class="sidebar-brand-copy">
                <strong class="sidebar-brand-name">BYOSE Market</strong>
                <span class="sidebar-brand-role">Admin</span>
              </div>
            </a>
            <button class="sidebar-collapse-toggle" type="button" id="sidebarCollapseToggle" aria-label="Collapse sidebar" aria-expanded="true" title="Collapse sidebar">
              <span></span>
              <span></span>
            </button>
          </div>

          <a class="sidebar-profile" href="#/settings?panel=profile" aria-label="Open admin profile">
            <span class="sidebar-profile-avatar" id="sidebarProfileAvatar">${avatarMarkup(adminProfile)}</span>
            <span class="sidebar-profile-copy">
              <strong id="sidebarProfileName">${escapeHeaderText(adminProfile.fullName)}</strong>
              <span id="sidebarProfileRole">${escapeHeaderText(adminProfile.roleLabel)}</span>
            </span>
            <span class="sidebar-profile-status${sessionStatus.online && sessionStatus.authenticated ? " is-online" : ""}" id="sidebarProfileStatus" aria-label="${sessionStatus.online && sessionStatus.authenticated ? "Online" : "Offline"}"></span>
          </a>

          <div class="sidebar-menu-region">
            <div class="sidebar-nav-scroll">
              <nav class="admin-nav" aria-label="Admin sections">
                ${ADMIN_NAVIGATION.map(navGroup).join("")}
              </nav>
            </div>
          </div>

          <div class="sidebar-admin-region">
            <div class="sidebar-footer">
              <div class="sidebar-session${sessionStatus.jwtProtected ? " is-secure" : ""}" id="sidebarSessionStatus">
                <span class="status-dot" aria-hidden="true"></span>
                <div>
                  <p id="sidebarSessionLabel">${escapeHeaderText(sessionStatus.label)}</p>
                  <strong id="sidebarSessionDetail">${escapeHeaderText(sessionStatus.detail)}</strong>
                </div>
              </div>
              <a class="sidebar-store-link" href="../index.html">View storefront</a>
              <button class="btn btn-secondary sidebar-logout-btn" data-admin-logout type="button">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${utilityIconSvg("logout")}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div class="admin-main" id="adminMainShell">
        <div class="admin-main-shell">
          <header class="admin-header" id="adminHeaderBar">
            <div class="admin-header-leading">
              <button class="btn btn-ghost menu-toggle" type="button" id="menuToggle" aria-label="Toggle navigation" aria-controls="adminSidebar" aria-expanded="false">
                <span class="menu-toggle-icon" aria-hidden="true"></span>
                <span>Menu</span>
              </button>
              <div class="header-title-block">
                <p class="header-kicker" id="headerSectionLabel">Core Operations</p>
                <h2 id="headerPageTitle">Dashboard</h2>
              </div>
            </div>

            <div class="header-search-shell">
              <form class="header-search-form" id="adminShellSearchForm" role="search" action="#/enterprise" method="get">
                <label class="header-search-field" for="adminShellSearch">
                  <span class="header-search-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="${utilityIconSvg("search")}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                  </span>
                  <input id="adminShellSearch" name="q" type="search" placeholder="Search orders, customers, products..." autocomplete="off" aria-autocomplete="list" aria-controls="adminShellSearchResults" aria-expanded="false">
                  <kbd class="header-search-shortcut" aria-hidden="true">/</kbd>
                </label>
                <div class="header-search-results" id="adminShellSearchResults" role="listbox" hidden></div>
              </form>
            </div>

            <div class="header-actions">
              <div class="header-action-cluster">
                <div class="header-panel-anchor">
                  <button class="header-utility-btn" type="button" aria-label="Notifications" data-header-panel-toggle="notifications" aria-expanded="false" aria-controls="headerNotificationsPanel">
                    <svg viewBox="0 0 24 24"><path d="${utilityIconSvg("bell")}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                    <span class="header-utility-badge" hidden>0</span>
                  </button>
                  <section class="header-panel header-notifications-panel" id="headerNotificationsPanel" data-header-panel="notifications" hidden>
                    <div class="header-panel-header">
                      <div>
                        <p>Notifications</p>
                        <strong>Notification Center</strong>
                      </div>
                      <span class="header-panel-badge">All caught up</span>
                    </div>
                    <div class="header-panel-body">
                      ${renderHeaderNotificationsPanelBody()}
                    </div>
                  </section>
                </div>
                <div class="header-panel-anchor">
                  <button class="header-utility-btn" type="button" aria-label="Quick actions" data-header-panel-toggle="actions" aria-expanded="false" aria-controls="headerQuickActionsPanel">
                    <svg viewBox="0 0 24 24"><path d="${utilityIconSvg("spark")}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                  </button>
                  <section class="header-panel" id="headerQuickActionsPanel" data-header-panel="actions" hidden>
                    <div class="header-panel-header">
                      <div>
                        <p>Quick Actions</p>
                        <strong>Operator shortcuts</strong>
                      </div>
                    </div>
                    <div class="header-panel-body header-panel-links">
                      ${quickActionItemsMarkup()}
                    </div>
                  </section>
                </div>
                <a class="header-utility-btn header-settings-btn" href="#/settings" aria-label="Admin settings">
                  <svg viewBox="0 0 24 24"><path d="${utilityIconSvg("settings")}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                </a>
              </div>
              <div class="header-status${sessionStatus.jwtProtected ? " is-secure" : ""}" id="headerSessionStatus">
                <span class="status-dot" aria-hidden="true"></span>
                <span id="headerSessionLabel">${escapeHeaderText(sessionStatus.label)}</span>
              </div>
              <div class="header-panel-anchor header-profile-anchor">
                <button class="header-profile" type="button" aria-label="Admin profile menu" data-header-panel-toggle="profile" aria-expanded="false" aria-controls="headerProfilePanel">
                  <span class="header-profile-avatar" id="headerProfileAvatar">${avatarMarkup(adminProfile)}</span>
                  <span class="header-profile-copy">
                    <strong id="headerProfileName">${escapeHeaderText(adminProfile.fullName)}</strong>
                    <span id="headerProfileRole">${escapeHeaderText(adminProfile.roleLabel)}</span>
                  </span>
                </button>
                <section class="header-panel header-profile-panel" id="headerProfilePanel" data-header-panel="profile" hidden>
                  <div class="header-panel-header header-profile-panel-header">
                    <span class="header-profile-avatar header-profile-avatar-large" id="headerProfileAvatarLarge">${avatarMarkup(adminProfile)}</span>
                    <div>
                      <p>Signed in as</p>
                      <strong id="headerProfilePanelDetail">${escapeHeaderText(adminProfile.fullName)}</strong>
                      <small id="headerProfileEmailDetail"${adminProfile.email ? "" : " hidden"}>${escapeHeaderText(adminProfile.email)}</small>
                    </div>
                  </div>
                  <div class="header-panel-body header-panel-links">
                    <a class="header-panel-link" href="#/settings?panel=profile">
                      <span class="header-panel-link-copy">
                        <strong>Account access</strong>
                        <small>Profile, role, and admin identity</small>
                      </span>
                      <span class="header-panel-link-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24"><path d="${utilityIconSvg("chevron")}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                      </span>
                    </a>
                    <a class="header-panel-link" href="#/settings?panel=security">
                      <span class="header-panel-link-copy">
                        <strong>Security controls</strong>
                        <small>Session, password, and access security</small>
                      </span>
                      <span class="header-panel-link-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24"><path d="${utilityIconSvg("shield")}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                      </span>
                    </a>
                    <button class="header-panel-link header-panel-link-button" type="button" data-admin-logout>
                      <span class="header-panel-link-copy">
                        <strong>Logout</strong>
                        <small>End the current secure admin session</small>
                      </span>
                    </button>
                  </div>
                </section>
              </div>
            </div>
          </header>

          <main class="admin-content" id="appContent" aria-live="polite">
            <section class="admin-content-shell" aria-label="Dashboard content viewport">
              <div class="admin-page-scroll">
                <div class="admin-page-container">
                  <header class="admin-page-heading" id="adminPageHeading">
                    <p class="admin-page-kicker" id="routeGroup">Core Operations</p>
                    <div class="admin-page-heading-row">
                      <div>
                        <p class="admin-page-section" id="routeSection">Dashboard</p>
                        <h1 id="routeTitle">Overview</h1>
                        <p class="admin-page-description" id="routeDescription">Central snapshot and storefront health</p>
                      </div>
                      <span class="admin-page-badge" id="routeBadge">Overview</span>
                    </div>
                    <p class="visually-hidden" id="routeKicker">Core Operations</p>
                  </header>
                  <section class="admin-page-surface" id="appPageSurface">
                    <div class="admin-page-content" id="appPageContent"></div>
                  </section>
                </div>
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
    ${modalTemplate()}
  `;
}

export function bindLayoutActions() {
  const shell = document.getElementById("adminAppShell");
  const toggle = document.getElementById("menuToggle");
  const sidebar = document.getElementById("adminSidebar");
  const backdrop = document.getElementById("adminSidebarBackdrop");
  const collapseToggle = document.getElementById("sidebarCollapseToggle");
  const navBranchElements = Array.from(document.querySelectorAll("[data-nav-branch]"));
  const navDestinationLinks = Array.from(document.querySelectorAll("[data-nav-destination-id]"));
  const headerPanelToggles = Array.from(document.querySelectorAll("[data-header-panel-toggle]"));
  const headerPanels = Array.from(document.querySelectorAll("[data-header-panel]"));
  const logoutButtons = Array.from(document.querySelectorAll("[data-admin-logout]"));
  const searchForm = document.getElementById("adminShellSearchForm");
  const searchInput = document.getElementById("adminShellSearch");
  const searchResults = document.getElementById("adminShellSearchResults");
  const drawerMediaQuery = window.matchMedia("(max-width: 1024px)");
  let responsiveSyncFrame = 0;

  const getBranchNodes = (branch) => ({
    trigger: Array.from(branch.children).find((node) => node.hasAttribute("data-nav-branch-trigger")) || null,
    panel: Array.from(branch.children).find((node) => node.hasAttribute("data-nav-branch-panel")) || null
  });

  const setExpandedBranchIds = (expandedIds) => {
    navBranchElements.forEach((branch) => {
      const branchId = branch.dataset.branchId;
      const isExpanded = expandedIds.has(branchId);
      const { trigger, panel } = getBranchNodes(branch);
      branch.classList.toggle("is-expanded", isExpanded);
      trigger?.setAttribute("aria-expanded", isExpanded ? "true" : "false");
      panel?.setAttribute("aria-hidden", isExpanded ? "false" : "true");
    });
  };

  const getActiveState = (routeKey = "") => collectActiveTrail(ADMIN_NAVIGATION, getNavigationLocation(routeKey));

  const syncExpandedBranches = (routeKey = "") => {
    const storedExpanded = readExpandedBranchIds();
    const { activeBranchIds } = getActiveState(routeKey);
    const merged = new Set([...storedExpanded, ...activeBranchIds]);
    setExpandedBranchIds(merged);
    return merged;
  };

  const syncNavigationState = (routeKey = "") => {
    const { activeBranchIds, activeItemIds } = getActiveState(routeKey);

    navBranchElements.forEach((branch) => {
      branch.classList.toggle("is-active-branch", activeBranchIds.has(branch.dataset.branchId));
    });

    navDestinationLinks.forEach((destination) => {
      const destinationId = destination.dataset.navDestinationId;
      const isActive = activeItemIds.has(destinationId);
      destination.classList.toggle("is-active", isActive);
      if (destination.tagName === "A") {
        if (isActive) {
          destination.setAttribute("aria-current", "page");
        } else {
          destination.removeAttribute("aria-current");
        }
      }
    });

    syncExpandedBranches(routeKey);
  };

  const syncMenuToggleState = (isOpen) => {
    if (toggle) {
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    }
  };

  const closeHeaderPanels = (exceptPanel = "") => {
    headerPanels.forEach((panel) => {
      const panelKey = panel.dataset.headerPanel || "";
      const shouldStayOpen = Boolean(exceptPanel && panelKey === exceptPanel);
      panel.hidden = !shouldStayOpen;
      panel.classList.toggle("is-open", shouldStayOpen);
    });

    headerPanelToggles.forEach((toggleButton) => {
      const panelKey = toggleButton.dataset.headerPanelToggle || "";
      const isExpanded = Boolean(exceptPanel && panelKey === exceptPanel);
      toggleButton.setAttribute("aria-expanded", isExpanded ? "true" : "false");
      toggleButton.classList.toggle("is-active", isExpanded);
    });
  };

  const isDrawerMode = () => drawerMediaQuery.matches;

  const syncCollapsedChrome = () => {
    const collapsed = Boolean(shell?.classList.contains("sidebar-collapsed"));
    const drawerOpen = Boolean(shell?.classList.contains("sidebar-drawer-open"));
    if (!collapseToggle) {
      return;
    }

    if (isDrawerMode()) {
      collapseToggle.setAttribute("aria-expanded", drawerOpen ? "true" : "false");
      collapseToggle.setAttribute("aria-label", drawerOpen ? "Close navigation" : "Open navigation");
      collapseToggle.setAttribute("title", drawerOpen ? "Close navigation" : "Open navigation");
      return;
    }

    collapseToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    collapseToggle.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    collapseToggle.setAttribute("title", collapsed ? "Expand sidebar" : "Collapse sidebar");
  };

  const setShellInteractivityState = (drawerOpen) => {
    document.body.classList.toggle("admin-nav-locked", drawerOpen);
    shell?.classList.toggle("sidebar-drawer-open", drawerOpen);
    shell?.classList.toggle("sidebar-overlay-visible", drawerOpen);
    shell?.classList.toggle("is-drawer-mode", isDrawerMode());
    sidebar?.classList.toggle("sidebar-open", drawerOpen);

    if (backdrop) {
      backdrop.hidden = false;
      backdrop.setAttribute("aria-hidden", drawerOpen ? "false" : "true");
      backdrop.classList.toggle("is-visible", drawerOpen);
    }

    if (toggle) {
      toggle.classList.toggle("is-active", drawerOpen);
    }

    if (isDrawerMode()) {
      sidebar?.setAttribute("aria-hidden", drawerOpen ? "false" : "true");
    } else {
      sidebar?.removeAttribute("aria-hidden");
    }

    syncCollapsedChrome();
  };

  const syncResponsiveShellMode = () => {
    closeHeaderPanels();
    const drawerMode = isDrawerMode();
    shell?.classList.toggle("is-drawer-mode", drawerMode);

    if (drawerMode) {
      shell?.classList.remove("sidebar-collapsed");
      syncCollapsedChrome();
    }

    if (!drawerMode) {
      document.body.classList.remove("admin-nav-locked");
      shell?.classList.remove("sidebar-drawer-open", "sidebar-overlay-visible");
      sidebar?.classList.remove("sidebar-open");
      backdrop?.classList.remove("is-visible");
      if (backdrop) {
        backdrop.hidden = true;
        backdrop.setAttribute("aria-hidden", "true");
      }
      syncMenuToggleState(false);
      toggle?.classList.remove("is-active");
      sidebar?.removeAttribute("aria-hidden");
      return;
    }

    if (!shell?.classList.contains("sidebar-drawer-open")) {
      setShellInteractivityState(false);
    }
  };

  const scheduleResponsiveShellMode = () => {
    if (responsiveSyncFrame) {
      return;
    }

    responsiveSyncFrame = window.requestAnimationFrame(() => {
      responsiveSyncFrame = 0;
      syncResponsiveShellMode();
    });
  };

  const closeMobileSidebar = () => {
    if (!shell || !sidebar || !backdrop) {
      return;
    }

    setShellInteractivityState(false);
    syncMenuToggleState(false);
  };

  const openMobileSidebar = () => {
    if (!shell || !sidebar || !backdrop) {
      return;
    }

    setShellInteractivityState(true);
    syncMenuToggleState(true);
  };

  if (toggle && sidebar) {
    toggle.addEventListener("click", () => {
      if (!isDrawerMode()) {
        shell?.classList.toggle("sidebar-collapsed");
        syncCollapsedChrome();
        return;
      }

      if (shell?.classList.contains("sidebar-drawer-open")) {
        closeMobileSidebar();
        return;
      }

      openMobileSidebar();
    });
  }

  if (collapseToggle) {
    collapseToggle.addEventListener("click", () => {
      if (isDrawerMode()) {
        closeMobileSidebar();
        return;
      }

      shell?.classList.toggle("sidebar-collapsed");
      syncCollapsedChrome();
    });
  }

  headerPanelToggles.forEach((toggleButton) => {
    toggleButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const panelKey = toggleButton.dataset.headerPanelToggle || "";
      const isExpanded = toggleButton.getAttribute("aria-expanded") === "true";
      closeHeaderPanels(isExpanded ? "" : panelKey);
      closeSearchResults();
    });
  });

  logoutButtons.forEach((button) => {
    button.addEventListener("click", () => {
      closeHeaderPanels();
      logout();
    });
  });

  navBranchElements.forEach((branch) => {
    const { trigger } = getBranchNodes(branch);
    if (!trigger) {
      return;
    }

    trigger.addEventListener("click", () => {
      if (shell?.classList.contains("sidebar-collapsed") && !isDrawerMode()) {
        shell.classList.remove("sidebar-collapsed");
        syncCollapsedChrome();
        return;
      }

      const branchId = branch.dataset.branchId;
      const isExpanded = branch.classList.contains("is-expanded");
      const nextExpanded = readExpandedBranchIds();
      const siblingBranches = Array.from(branch.parentElement?.children || []).filter((node) => node !== branch && node.hasAttribute?.("data-nav-branch"));

      siblingBranches.forEach((sibling) => {
        nextExpanded.delete(sibling.dataset.branchId);
      });

      if (isExpanded) {
        nextExpanded.delete(branchId);
      } else {
        nextExpanded.add(branchId);
      }

      persistExpandedBranchIds(nextExpanded);
      setExpandedBranchIds(nextExpanded);
    });
  });

  navDestinationLinks.forEach((link) => {
    link.addEventListener("click", () => {
      closeHeaderPanels();
      closeSearchResults();
      if (isDrawerMode()) {
        closeMobileSidebar();
      }
    });
  });

  if (backdrop) {
    backdrop.addEventListener("click", closeMobileSidebar);
  }

  searchInput?.addEventListener("input", () => {
    const matches = renderSearchResults(searchInput.value);
    searchInput.setAttribute("aria-expanded", matches.length || String(searchInput.value || "").trim() ? "true" : "false");
  });

  searchInput?.addEventListener("focus", () => {
    if (String(searchInput.value || "").trim()) {
      renderSearchResults(searchInput.value);
    }
  });

  searchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitAdminSearch(searchInput?.value || "", filterSearchDestinations(searchInput?.value || ""));
  });

  searchResults?.addEventListener("mousemove", (event) => {
    const result = event.target?.closest?.(".header-search-result");
    if (!result) return;
    searchResults.querySelectorAll(".header-search-result").forEach((node) => node.classList.toggle("is-active", node === result));
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-header-panel-toggle]") && !event.target.closest("[data-header-panel]")) {
      closeHeaderPanels();
    }

    if (!event.target.closest(".header-search-shell")) {
      closeSearchResults();
    }

    if (!sidebar || !isDrawerMode() || !shell?.classList.contains("sidebar-drawer-open")) {
      return;
    }

    if (event.target.closest("#menuToggle") || event.target.closest("#adminSidebar")) {
      return;
    }

    closeMobileSidebar();
  });

  document.addEventListener("keydown", (event) => {
    const key = String(event.key || "");
    const target = event.target;
    const typingInField = Boolean(target?.closest?.("input, textarea, select, [contenteditable='true']"));

    if ((key === "/" || (key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey))) && !typingInField) {
      event.preventDefault();
      searchInput?.focus();
      searchInput?.select?.();
      return;
    }

    if (key === "Escape") {
      closeHeaderPanels();
      closeSearchResults();
      closeMobileSidebar();
      searchInput?.blur();
      return;
    }

    if (document.activeElement === searchInput && (key === "ArrowDown" || key === "ArrowUp")) {
      const results = Array.from(document.querySelectorAll(".header-search-result"));
      if (!results.length) return;
      event.preventDefault();
      const current = results.findIndex((node) => node.classList.contains("is-active"));
      const delta = key === "ArrowDown" ? 1 : -1;
      const next = results[(current + delta + results.length) % results.length];
      results.forEach((node) => node.classList.toggle("is-active", node === next));
    }
  });

  window.addEventListener("resize", scheduleResponsiveShellMode);
  drawerMediaQuery.addEventListener?.("change", scheduleResponsiveShellMode);

  window.addEventListener("hashchange", () => {
    closeHeaderPanels();
    closeSearchResults();
    if (isDrawerMode()) {
      closeMobileSidebar();
    }
    syncNavigationState();
    syncSessionStatusChrome();
  });

  window.addEventListener("online", syncSessionStatusChrome);
  window.addEventListener("offline", syncSessionStatusChrome);
  window.addEventListener("focus", syncSessionStatusChrome);

  syncResponsiveShellMode();
  syncNavigationState();
  syncCollapsedChrome();
  syncSessionStatusChrome();

  const syncHeaderProfileFromEvent = (event) => {
    const next = readAdminSessionProfile();
    const detailProfile = event?.detail?.profile;
    const fullName = String(detailProfile?.name || next.fullName || "").trim() || next.fullName;
    const role = String(detailProfile?.role || next.role || "admin");
    const email = String(detailProfile?.email || next.email || "");
    const avatarUrl = String(detailProfile?.avatarUrl || next.avatarUrl || "").trim();
    applyProfileToChrome({
      fullName,
      email,
      role,
      roleLabel: formatAdminRole(role),
      avatarUrl,
      initials: next.initials
    });
    syncSessionStatusChrome();
  };

  window.addEventListener("byose:admin-profile-updated", syncHeaderProfileFromEvent);

  const notificationsPanel = document.getElementById("headerNotificationsPanel");
  notificationsPanel?.addEventListener("click", async (event) => {
    const markAllBtn = event.target?.closest?.('[data-header-notifications-action="mark-all"]');
    if (markAllBtn) {
      event.preventDefault();
      try {
        await markAllNotificationsRead();
        await refreshHeaderNotifications({ force: true });
      } catch (error) {
        console.error(error);
      }
      return;
    }

    const itemBtn = event.target?.closest?.("[data-header-notification-id]");
    if (!itemBtn) return;
    const notificationId = itemBtn.getAttribute("data-header-notification-id");
    if (!notificationId) return;
    try {
      await markNotificationRead(notificationId);
      await refreshHeaderNotifications({ force: true });
    } catch (error) {
      console.error(error);
    }
  });

  headerPanelToggles.forEach((toggleButton) => {
    if (toggleButton.dataset.headerPanelToggle !== "notifications") return;
    toggleButton.addEventListener("click", () => {
      void refreshHeaderNotifications({ force: true });
    });
  });

  window.addEventListener("admin:notifications-changed", () => {
    void refreshHeaderNotifications({ force: true });
  });

  bindHeaderNotificationsRealtime();
  void refreshHeaderNotifications({ force: true });
  window.setInterval(() => {
    void refreshHeaderNotifications({ force: true });
  }, 60000);
}

export function setRouteTitle(title) {
  const node = document.getElementById("routeTitle");
  const headerTitle = document.getElementById("headerPageTitle");
  if (node) {
    node.textContent = title || "Dashboard";
  }
  if (headerTitle && !document.getElementById("routeTitle")) {
    headerTitle.textContent = title || "Dashboard";
  }
}

export function setActiveNav(routeKey) {
  const metadata = ROUTE_METADATA[routeKey] || ROUTE_METADATA.dashboard || {};
  const navigationContext = resolveNavigationContext(ADMIN_NAVIGATION, routeKey);
  const groupNode = document.getElementById("routeGroup");
  const sectionNode = document.getElementById("routeSection");
  const kickerNode = document.getElementById("routeKicker");
  const titleNode = document.getElementById("routeTitle");
  const badgeNode = document.getElementById("routeBadge");
  const descriptionNode = document.getElementById("routeDescription");
  const headerSection = document.getElementById("headerSectionLabel");
  const headerTitle = document.getElementById("headerPageTitle");

  const groupLabel = navigationContext.group || metadata.group || "Operations";
  const sectionLabel = navigationContext.section || metadata.section || metadata.title || "Dashboard";
  const pageTitle = navigationContext.title || metadata.title || "Dashboard";
  const pageDescription = navigationContext.description || metadata.description || "Central snapshot and storefront health";
  const pageBadge = navigationContext.badge || metadata.section || "Live workspace";

  if (groupNode) groupNode.textContent = groupLabel;
  if (sectionNode) sectionNode.textContent = sectionLabel;
  if (kickerNode) kickerNode.textContent = groupLabel;
  if (titleNode) titleNode.textContent = pageTitle;
  if (badgeNode) badgeNode.textContent = pageBadge;
  if (descriptionNode) descriptionNode.textContent = pageDescription;
  if (headerSection) headerSection.textContent = groupLabel;
  if (headerTitle) headerTitle.textContent = pageTitle;

  const { activeBranchIds, activeItemIds } = collectActiveTrail(ADMIN_NAVIGATION, getNavigationLocation(routeKey));
  const expandedBranchIds = new Set([...readExpandedBranchIds(), ...activeBranchIds]);

  document.querySelectorAll(".nav-group").forEach((group) => {
    const hasActiveBranch = Array.from(group.querySelectorAll("[data-nav-branch]")).some((branch) => activeBranchIds.has(branch.dataset.branchId));
    group.classList.toggle("is-current-group", hasActiveBranch);
  });

  document.querySelectorAll("[data-nav-destination-id]").forEach((node) => {
    const isActive = activeItemIds.has(node.dataset.navDestinationId);
    node.classList.toggle("is-active", isActive);
    if (node.tagName === "A") {
      if (isActive) {
        node.setAttribute("aria-current", "page");
      } else {
        node.removeAttribute("aria-current");
      }
    }
  });

  document.querySelectorAll("[data-nav-branch]").forEach((branch) => {
    const isActiveBranch = activeBranchIds.has(branch.dataset.branchId);
    const isExpanded = expandedBranchIds.has(branch.dataset.branchId);
    branch.classList.toggle("is-active-branch", isActiveBranch);
    branch.classList.toggle("is-expanded", isExpanded);

    const trigger = Array.from(branch.children).find((node) => node.hasAttribute("data-nav-branch-trigger"));
    const panel = Array.from(branch.children).find((node) => node.hasAttribute("data-nav-branch-panel"));
    trigger?.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    panel?.setAttribute("aria-hidden", isExpanded ? "false" : "true");
  });
}
