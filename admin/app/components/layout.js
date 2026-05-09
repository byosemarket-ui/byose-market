import { ROUTE_ORDER } from "../core/constants.js";
import { modalTemplate } from "./ui.js";

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
    enterprise: "M4 5h16v14H4zM4 9h16M9 5v14M15 5v14"
  };

  return iconMap[iconName] || iconMap.grid;
}

function navItem(item) {
  return `
    <a class="nav-link" data-route="${item.key}" href="${item.path}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${iconSvg(item.icon)}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
      <span>${item.label}</span>
    </a>
  `;
}

export function renderAppShell(rootElement) {
  rootElement.innerHTML = `
    <div class="admin-app">
      <aside class="admin-sidebar" id="adminSidebar">
        <div class="brand-block">
          <p class="brand-kicker">Byose Market</p>
          <h1>Admin Console</h1>
        </div>
        <nav class="admin-nav" aria-label="Admin sections">
          ${ROUTE_ORDER.map(navItem).join("")}
        </nav>
        <div class="sidebar-footer">
          <button class="btn btn-secondary" data-admin-logout type="button">Logout</button>
        </div>
      </aside>

      <div class="admin-main">
        <header class="admin-header">
          <button class="btn btn-ghost menu-toggle" type="button" id="menuToggle" aria-label="Toggle navigation">Menu</button>
          <div>
            <p class="header-kicker">Ecommerce Admin</p>
            <h2 id="routeTitle">Dashboard</h2>
          </div>
          <div class="header-status">
            <span class="status-dot"></span>
            <span>Connected</span>
          </div>
        </header>

        <main class="admin-content" id="appContent" aria-live="polite"></main>
      </div>
    </div>
    ${modalTemplate()}
  `;
}

export function bindLayoutActions() {
  const toggle = document.getElementById("menuToggle");
  const sidebar = document.getElementById("adminSidebar");

  if (toggle && sidebar) {
    toggle.addEventListener("click", () => {
      sidebar.classList.toggle("sidebar-open");
    });
  }

  document.addEventListener("click", (event) => {
    if (!sidebar || window.innerWidth > 960) {
      return;
    }

    if (event.target.closest("#menuToggle") || event.target.closest("#adminSidebar")) {
      return;
    }

    sidebar.classList.remove("sidebar-open");
  });
}

export function setRouteTitle(title) {
  const node = document.getElementById("routeTitle");
  if (node) {
    node.textContent = title || "Dashboard";
  }
}

export function setActiveNav(routeKey) {
  document.querySelectorAll(".nav-link[data-route]").forEach((node) => {
    node.classList.toggle("is-active", node.dataset.route === routeKey);
  });
}
