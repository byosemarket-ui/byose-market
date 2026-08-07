import { ADMIN_NAVIGATION, NAVIGATION_CATEGORY_TOTAL, NAVIGATION_DESTINATION_TOTAL, ROUTE_METADATA } from "../core/navigation.js";
import { logout } from "../core/auth.js";
import { collectActiveTrail, getNavigationLocation, persistExpandedBranchIds, readExpandedBranchIds, resolveAdminHref, resolveNavigationContext } from "../core/sidebar-navigation.js";
import { modalTemplate } from "./ui.js";

const HEADER_NOTIFICATIONS = [
  {
    id: "ops-sync",
    title: "Operations sync queued",
    detail: "Realtime admin alerts will land here once the live notifications layer is connected.",
    tone: "info"
  },
  {
    id: "support-inbox",
    title: "Support inbox watch",
    detail: "Customer messages and contact requests will surface in this panel for fast triage.",
    tone: "warn"
  },
  {
    id: "security-session",
    title: "Session secured",
    detail: "JWT-backed admin session validation remains active across the shell.",
    tone: "success"
  }
];

const HEADER_QUICK_ACTIONS = [
  { id: "quick-orders", label: "Open Orders", href: "#/orders", detail: "Fulfillment and status operations" },
  { id: "quick-products", label: "Add Product", href: "#/products?view=create&step=info", detail: "Create a new catalog item" },
  { id: "quick-settings", label: "Admin Settings", href: "#/settings?panel=profile", detail: "Profile and access controls" }
];

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

function countLeafDestinations(entries) {
  return entries.reduce((count, entry) => {
    const childEntries = Array.isArray(entry.children) ? entry.children : [];
    if (!childEntries.length) {
      return count + 1;
    }

    return count + countLeafDestinations(childEntries);
  }, 0);
}

function navDestination(item, depth) {
  const destinationClass = depth > 1 ? "nav-sublink nav-sublink-nested" : "nav-sublink";
  const descriptionMarkup = item.description ? `<small>${item.description}</small>` : "";

  if (item.action === "logout") {
    return `
      <button class="${destinationClass} nav-sublink-action" type="button" data-admin-logout data-nav-destination-id="${item.id}">
        <span class="nav-sublink-dot" aria-hidden="true"></span>
        <span class="nav-sublink-copy">
          <strong>${item.label}</strong>
          ${descriptionMarkup}
        </span>
      </button>
    `;
  }

  return `
    <a class="${destinationClass}" data-nav-destination-id="${item.id}" href="${resolveAdminHref(item.href)}">
      <span class="nav-sublink-dot" aria-hidden="true"></span>
      <span class="nav-sublink-copy">
        <strong>${item.label}</strong>
        ${descriptionMarkup}
      </span>
    </a>
  `;
}

function navBranch(item, depth = 0) {
  const childEntries = Array.isArray(item.children) ? item.children : [];
  if (!childEntries.length) {
    return navDestination(item, depth);
  }

  const descriptionMarkup = item.description ? `<small>${item.description}</small>` : "";
  const iconMarkup = depth === 0
    ? `
      <span class="nav-branch-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="${iconSvg(item.icon)}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
      </span>
    `
    : `<span class="nav-branch-bullet" aria-hidden="true"></span>`;

  return `
    <section class="nav-branch nav-depth-${depth}" data-nav-branch data-branch-id="${item.id}">
      <button class="nav-branch-trigger" type="button" data-nav-branch-trigger aria-expanded="false" aria-controls="nav-panel-${item.id}">
        ${iconMarkup}
        <span class="nav-branch-copy">
          <strong>${item.label}</strong>
          ${descriptionMarkup}
        </span>
        <span class="nav-branch-summary">${countLeafDestinations(childEntries)} items</span>
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
    <section class="nav-group" aria-label="${group.label}">
      <div class="nav-group-header">
        <span class="nav-group-title">${group.label}</span>
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
    shield: "M12 3l7 3v5c0 4.4-3 8.2-7 10-4-1.8-7-5.6-7-10V6l7-3Z"
  };

  return iconMap[iconName] || iconMap.search;
}

function readAdminSessionProfile() {
  try {
    const snapshot = window.AdminSecurity && typeof window.AdminSecurity.getSessionSnapshot === "function"
      ? window.AdminSecurity.getSessionSnapshot()
      : null;
    const profile = snapshot && snapshot.profile && typeof snapshot.profile === "object" ? snapshot.profile : null;
    const email = String(profile?.email || snapshot?.email || "admin@byosemarket.com").trim() || "admin@byosemarket.com";
    const fullName = String(profile?.name || "").trim();
    const firstName = String(profile?.firstName || fullName.split(/\s+/)[0] || "Central").trim() || "Central";
    const lastName = String(
      profile?.lastName
      || (fullName.includes(" ") ? fullName.split(/\s+/).slice(1).join(" ") : "Admin")
    ).trim() || "Admin";
    const role = String(profile?.role || "admin").trim() || "admin";
    const avatarUrl = String(profile?.avatarUrl || "").trim();
    const avatar = String(profile?.avatar || "").trim();
    const resolvedAvatar = avatarUrl
      || (avatar
        ? (/^https?:\/\//i.test(avatar) || avatar.startsWith("/") ? avatar : `/uploads/${avatar.replace(/^\/+/, "")}`)
        : "");

    return {
      fullName: fullName || `${firstName} ${lastName}`.trim(),
      email,
      role,
      avatarUrl: resolvedAvatar,
      initials: `${firstName.charAt(0)}${lastName.charAt(0)}`.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "CA"
    };
  } catch (_error) {
    return {
      fullName: "Central Admin",
      email: "admin@byosemarket.com",
      role: "admin",
      avatarUrl: "",
      initials: "CA"
    };
  }
}

function notificationItemsMarkup() {
  return HEADER_NOTIFICATIONS.map((item) => `
    <article class="header-panel-card header-panel-card-${item.tone}">
      <strong>${item.title}</strong>
      <p>${item.detail}</p>
    </article>
  `).join("");
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

export function renderAppShell(rootElement) {
  const adminProfile = readAdminSessionProfile();

  rootElement.innerHTML = `
    <a class="skip-link" href="#appPageContent">Skip to dashboard content</a>
    <div class="admin-app" id="adminAppShell" data-layout="enterprise-admin">
      <div class="admin-sidebar-backdrop" id="adminSidebarBackdrop" hidden></div>
      <aside class="admin-sidebar" id="adminSidebar" aria-label="Primary admin sidebar">
        <div class="admin-sidebar-inner">
          <div class="sidebar-shell">
            <div class="sidebar-brand-panel">
              <div class="sidebar-brand-mark" aria-hidden="true"><span>BM</span></div>
              <div class="sidebar-brand-copy brand-block">
                <p class="brand-kicker">Centralized Commerce</p>
                <h1>Byose Admin</h1>
                <p class="brand-summary">Professional operations workspace for orders, customers, catalog, and platform oversight.</p>
              </div>
            </div>
            <div class="sidebar-shell-actions">
              <span class="sidebar-shell-tag">Shell Foundation</span>
              <button class="sidebar-collapse-toggle" type="button" id="sidebarCollapseToggle" aria-label="Collapse sidebar">
                <span></span>
                <span></span>
              </button>
            </div>
          </div>
          <div class="sidebar-meta" aria-label="Workspace state">
            <span class="sidebar-meta-pill">JWT secured</span>
            <span class="sidebar-meta-pill">Central APIs</span>
            <span class="sidebar-meta-pill">Responsive shell</span>
          </div>
          <div class="sidebar-menu-region">
            <div class="sidebar-menu-heading">
              <div>
                <p>Workspace navigation</p>
                <strong>${NAVIGATION_CATEGORY_TOTAL} categories / ${NAVIGATION_DESTINATION_TOTAL} destinations</strong>
              </div>
              <span class="sidebar-menu-status">Live</span>
            </div>
            <div class="sidebar-nav-scroll">
              <nav class="admin-nav" aria-label="Admin sections">
                ${ADMIN_NAVIGATION.map(navGroup).join("")}
              </nav>
            </div>
          </div>
          <div class="sidebar-admin-region">
            <div class="sidebar-footer">
              <div class="sidebar-footer-card">
                <p>Admin session protected</p>
                <strong>JWT validation active</strong>
              </div>
              <button class="btn btn-secondary" data-admin-logout type="button">Logout</button>
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
                <nav class="header-breadcrumbs" aria-label="Current page path">
                  <span class="header-breadcrumb-chip">Admin Console</span>
                  <span class="header-breadcrumb-divider" aria-hidden="true">/</span>
                  <span class="header-breadcrumb-node" id="routeGroup">Core Operations</span>
                  <span class="header-breadcrumb-divider" aria-hidden="true">/</span>
                  <span class="header-breadcrumb-current" id="routeSection">Dashboard</span>
                </nav>
                <p class="header-kicker" id="routeKicker">Overview</p>
                <div class="header-title-row">
                  <h2 id="routeTitle">Dashboard</h2>
                  <span class="header-route-badge" id="routeBadge">Live workspace</span>
                </div>
                <p class="header-route-summary" id="routeDescription">Central snapshot and storefront health</p>
              </div>
            </div>
            <div class="header-search-shell" aria-label="Admin search foundation">
              <label class="header-search-field" for="adminShellSearch">
                <span class="header-search-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="${utilityIconSvg("search")}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                </span>
                <input id="adminShellSearch" type="search" placeholder="Search orders, customers, products" autocomplete="off" disabled aria-disabled="true">
              </label>
              <div class="header-search-meta">
                <p class="header-search-caption">Search foundation prepared for enterprise command and discovery workflows.</p>
                <span class="header-search-shortcut">Press / for search</span>
              </div>
            </div>
            <div class="header-actions">
              <div class="header-action-cluster">
                <div class="header-panel-anchor">
                  <button class="header-utility-btn" type="button" aria-label="Notifications foundation" data-header-panel-toggle="notifications" aria-expanded="false" aria-controls="headerNotificationsPanel">
                    <svg viewBox="0 0 24 24"><path d="${utilityIconSvg("bell")}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                    <span class="header-utility-badge">${HEADER_NOTIFICATIONS.length}</span>
                  </button>
                  <section class="header-panel header-notifications-panel" id="headerNotificationsPanel" data-header-panel="notifications" hidden>
                    <div class="header-panel-header">
                      <div>
                        <p>Notifications</p>
                        <strong>Realtime foundation</strong>
                      </div>
                      <span class="header-panel-badge">${HEADER_NOTIFICATIONS.length} unread</span>
                    </div>
                    <div class="header-panel-body">
                      ${notificationItemsMarkup()}
                    </div>
                  </section>
                </div>
                <div class="header-panel-anchor">
                  <button class="header-utility-btn" type="button" aria-label="Quick actions foundation" data-header-panel-toggle="actions" aria-expanded="false" aria-controls="headerQuickActionsPanel">
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
                <button class="header-utility-btn header-settings-btn" type="button" aria-label="Quick settings placeholder">
                  <svg viewBox="0 0 24 24"><path d="${utilityIconSvg("settings")}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                </button>
              </div>
              <div class="header-status">
                <span class="status-dot"></span>
                <span>Secure session live</span>
              </div>
              <div class="header-panel-anchor header-profile-anchor">
                <button class="header-profile" type="button" aria-label="Admin profile area" data-header-panel-toggle="profile" aria-expanded="false" aria-controls="headerProfilePanel">
                  <span class="header-profile-avatar" id="headerProfileAvatar">
                    ${adminProfile.avatarUrl
                      ? `<img src="${adminProfile.avatarUrl}" alt="" />`
                      : adminProfile.initials}
                  </span>
                  <span class="header-profile-copy">
                    <strong id="headerProfileName">${adminProfile.fullName}</strong>
                    <span id="headerProfileRole">${adminProfile.role}</span>
                  </span>
                </button>
                <section class="header-panel header-profile-panel" id="headerProfilePanel" data-header-panel="profile" hidden>
                  <div class="header-panel-header header-profile-panel-header">
                    <span class="header-profile-avatar header-profile-avatar-large" id="headerProfileAvatarLarge">
                      ${adminProfile.avatarUrl
                        ? `<img src="${adminProfile.avatarUrl}" alt="" />`
                        : adminProfile.initials}
                    </span>
                    <div>
                      <p>Signed in as</p>
                      <strong id="headerProfilePanelDetail">${adminProfile.fullName}</strong>
                      <small id="headerProfileEmailDetail">${adminProfile.email}</small>
                    </div>
                  </div>
                  <div class="header-panel-body header-panel-links">
                    <a class="header-panel-link" href="#/settings?panel=profile">
                      <span class="header-panel-link-copy">
                        <strong>Account access</strong>
                        <small>Profile, role, and admin identity foundation</small>
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
  };

  const syncResponsiveShellMode = () => {
    closeHeaderPanels();
    const drawerMode = isDrawerMode();
    shell?.classList.toggle("is-drawer-mode", drawerMode);

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
    });
  }

  headerPanelToggles.forEach((toggleButton) => {
    toggleButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const panelKey = toggleButton.dataset.headerPanelToggle || "";
      const isExpanded = toggleButton.getAttribute("aria-expanded") === "true";
      closeHeaderPanels(isExpanded ? "" : panelKey);
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
      if (isDrawerMode()) {
        closeMobileSidebar();
      }
    });
  });

  if (backdrop) {
    backdrop.addEventListener("click", closeMobileSidebar);
  }

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-header-panel-toggle]") && !event.target.closest("[data-header-panel]")) {
      closeHeaderPanels();
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
    if (event.key === "Escape") {
      closeHeaderPanels();
      closeMobileSidebar();
    }
  });

  window.addEventListener("resize", scheduleResponsiveShellMode);
  drawerMediaQuery.addEventListener?.("change", scheduleResponsiveShellMode);

  window.addEventListener("hashchange", () => {
    closeHeaderPanels();
    if (isDrawerMode()) {
      closeMobileSidebar();
    }
    syncNavigationState();
  });

  syncResponsiveShellMode();
  syncNavigationState();

  const syncHeaderProfileFromEvent = (event) => {
    const next = readAdminSessionProfile();
    const detailProfile = event?.detail?.profile;
    const fullName = String(detailProfile?.name || next.fullName || "").trim() || next.fullName;
    const role = String(detailProfile?.role || next.role || "admin");
    const email = String(detailProfile?.email || next.email || "");
    const avatarUrl = String(detailProfile?.avatarUrl || next.avatarUrl || "").trim();
    const initials = next.initials;

    const nameNode = document.getElementById("headerProfileName");
    const roleNode = document.getElementById("headerProfileRole");
    const detailName = document.getElementById("headerProfilePanelDetail");
    const detailEmail = document.getElementById("headerProfileEmailDetail");
    const avatarNode = document.getElementById("headerProfileAvatar");
    const avatarLarge = document.getElementById("headerProfileAvatarLarge");

    if (nameNode) nameNode.textContent = fullName;
    if (roleNode) roleNode.textContent = role;
    if (detailName) detailName.textContent = fullName;
    if (detailEmail) detailEmail.textContent = email;

    const safeAvatarUrl = avatarUrl.replace(/"/g, "");
    const avatarHtml = safeAvatarUrl ? `<img src="${safeAvatarUrl}?v=${Date.now()}" alt="" />` : initials;
    if (avatarNode) avatarNode.innerHTML = avatarHtml;
    if (avatarLarge) avatarLarge.innerHTML = avatarHtml;
  };

  window.addEventListener("byose:admin-profile-updated", syncHeaderProfileFromEvent);
}

export function setRouteTitle(title) {
  const node = document.getElementById("routeTitle");
  if (node) {
    node.textContent = title || "Dashboard";
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

  if (groupNode) {
    groupNode.textContent = navigationContext.group || metadata.group || "Operations";
  }

  if (sectionNode) {
    sectionNode.textContent = navigationContext.section || metadata.section || metadata.title || "Dashboard";
  }

  if (kickerNode) {
    kickerNode.textContent = navigationContext.group || metadata.group || "Overview";
  }

  if (titleNode) {
    titleNode.textContent = navigationContext.title || metadata.title || "Dashboard";
  }

  if (badgeNode) {
    badgeNode.textContent = navigationContext.badge || metadata.section || "Live workspace";
  }

  if (descriptionNode) {
    descriptionNode.textContent = navigationContext.description || metadata.description || "Central snapshot and storefront health";
  }

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
