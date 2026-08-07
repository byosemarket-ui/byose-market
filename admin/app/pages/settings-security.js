import { emptyState, escapeHtml, formatDate, panel, table } from "../components/ui.js";
import {
  getAdminLoginHistory,
  getAdminSecurityEvents,
  getAdminSecurityOverview,
  logoutOtherAdminSessions,
  removeAdminTrustedDevice,
  renameAdminTrustedDevice,
  terminateAdminSession,
  trustCurrentAdminDevice,
  updateAdminTwoFactorPlaceholder
} from "../services/admin-data.service.js";
import { logout } from "../core/auth.js";

function attr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function locationLabel(item) {
  const parts = [item?.city, item?.country || item?.location].filter(Boolean);
  if (parts.length) return parts.join(", ");
  return item?.location || "Unknown";
}

function statusChip(status) {
  const normalized = String(status || "").toLowerCase();
  const tone = normalized === "success" || normalized === "active"
    ? "success"
    : (normalized === "failed" ? "danger" : "info");
  return `<span class="admin-profile-chip admin-profile-chip-${tone}">${escapeHtml(status || "—")}</span>`;
}

function sectionCard(title, subtitle, body) {
  return `
    <section class="admin-profile-card admin-security-card">
      <header class="admin-profile-card-header">
        <div>
          <h4>${escapeHtml(title)}</h4>
          <p>${escapeHtml(subtitle || "")}</p>
        </div>
      </header>
      ${body}
    </section>
  `;
}

function sessionsMarkup(sessions = []) {
  if (!sessions.length) {
    return emptyState("No active sessions found.");
  }

  return `
    <div class="admin-security-session-list">
      ${sessions.map((session) => `
        <article class="admin-security-session ${session.isCurrent ? "is-current" : ""}" data-session-id="${attr(session.sessionId)}">
          <div class="admin-security-session-main">
            <div class="admin-security-session-title">
              <strong>${escapeHtml(session.deviceName || "Unknown device")}</strong>
              ${session.isCurrent ? '<span class="admin-profile-chip admin-profile-chip-success">Current session</span>' : ""}
            </div>
            <p>${escapeHtml(session.browser || "Unknown browser")} · ${escapeHtml(session.os || "Unknown OS")}</p>
            <div class="admin-security-meta-row">
              <span>IP ${escapeHtml(session.ip || "—")}</span>
              <span>${escapeHtml(locationLabel(session))}</span>
              <span>Login ${escapeHtml(formatDateTime(session.createdAt))}</span>
              <span>Active ${escapeHtml(formatDateTime(session.lastActivityAt))}</span>
            </div>
          </div>
          <div class="admin-security-session-actions">
            ${session.isCurrent
              ? `<button class="btn btn-ghost" type="button" data-logout-current="${attr(session.sessionId)}">Logout Current Session</button>`
              : `<button class="btn btn-ghost" type="button" data-logout-session="${attr(session.sessionId)}">Logout Session</button>`}
          </div>
        </article>
      `).join("")}
    </div>
    <div class="admin-security-toolbar">
      <button class="btn btn-primary" type="button" id="logoutOtherSessionsBtn">Logout All Other Sessions</button>
      <p class="admin-profile-help">Ending another session signs that browser out immediately. Ending the current session requires confirmation.</p>
    </div>
  `;
}

function loginHistoryControls(state) {
  return `
    <div class="admin-security-filters">
      <label>
        <span>Search</span>
        <input id="loginHistorySearch" type="search" value="${attr(state.query)}" placeholder="IP, device, browser, city..." />
      </label>
      <label>
        <span>Status</span>
        <select id="loginHistoryStatus">
          <option value="all" ${state.status === "all" ? "selected" : ""}>All</option>
          <option value="success" ${state.status === "success" ? "selected" : ""}>Success</option>
          <option value="failed" ${state.status === "failed" ? "selected" : ""}>Failed</option>
        </select>
      </label>
      <label>
        <span>Sort</span>
        <select id="loginHistorySort">
          <option value="created_at_desc" ${state.sort === "created_at_desc" ? "selected" : ""}>Newest first</option>
          <option value="created_at_asc" ${state.sort === "created_at_asc" ? "selected" : ""}>Oldest first</option>
          <option value="status_asc" ${state.sort === "status_asc" ? "selected" : ""}>Status A–Z</option>
          <option value="ip_asc" ${state.sort === "ip_asc" ? "selected" : ""}>IP A–Z</option>
        </select>
      </label>
      <button class="btn btn-ghost" type="button" id="loginHistoryApply">Apply</button>
    </div>
  `;
}

function loginHistoryMarkup(payload, state) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const pagination = payload?.pagination || { page: 1, totalPages: 1, total: 0 };

  return `
    ${loginHistoryControls(state)}
    ${items.length ? table(
      ["Date", "Time", "Device", "Browser", "OS", "IP", "Location", "Status", "Logout"],
      items.map((item) => {
        const created = item.createdAt ? new Date(item.createdAt) : null;
        const dateLabel = created && !Number.isNaN(created.getTime()) ? formatDate(created) : "—";
        const timeLabel = created && !Number.isNaN(created.getTime())
          ? created.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
          : "—";
        return [
          dateLabel,
          timeLabel,
          item.deviceName || item.device || "—",
          item.browser || "—",
          item.os || "—",
          item.ip || "—",
          locationLabel(item),
          { html: statusChip(item.status) },
          formatDateTime(item.logoutAt)
        ];
      })
    ) : emptyState("No login history matches your filters.")}
    <div class="admin-security-pagination">
      <button class="btn btn-ghost" type="button" id="loginHistoryPrev" ${pagination.page <= 1 ? "disabled" : ""}>Previous</button>
      <span>Page ${escapeHtml(pagination.page)} of ${escapeHtml(pagination.totalPages)} · ${escapeHtml(pagination.total)} records</span>
      <button class="btn btn-ghost" type="button" id="loginHistoryNext" ${pagination.page >= pagination.totalPages ? "disabled" : ""}>Next</button>
    </div>
  `;
}

function trustedDevicesMarkup(devices = []) {
  if (!devices.length) {
    return `
      <div class="admin-security-toolbar">
        <button class="btn btn-primary" type="button" id="trustCurrentDeviceBtn">Trust This Device</button>
        <p class="admin-profile-help">No trusted devices yet. Trusting this browser helps flag unfamiliar sign-ins.</p>
      </div>
      ${emptyState("No trusted devices saved.")}
    `;
  }

  return `
    <div class="admin-security-toolbar">
      <button class="btn btn-primary" type="button" id="trustCurrentDeviceBtn">Trust This Device</button>
    </div>
    <div class="admin-security-device-list">
      ${devices.map((device) => `
        <article class="admin-security-device" data-device-id="${attr(device.id)}">
          <div>
            <strong class="admin-security-device-name">${escapeHtml(device.deviceName || "Trusted device")}</strong>
            <p>${escapeHtml(device.browser || "—")} · ${escapeHtml(device.os || "—")}</p>
            <div class="admin-security-meta-row">
              <span>Created ${escapeHtml(formatDateTime(device.createdAt))}</span>
              <span>Last activity ${escapeHtml(formatDateTime(device.lastActivityAt))}</span>
              <span>IP ${escapeHtml(device.ip || "—")}</span>
            </div>
          </div>
          <div class="admin-security-session-actions">
            <button class="btn btn-ghost" type="button" data-rename-device="${attr(device.id)}">Rename</button>
            <button class="btn btn-ghost" type="button" data-remove-device="${attr(device.id)}">Remove</button>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function eventsMarkup(items = []) {
  if (!items.length) {
    return emptyState("No security events recorded yet.");
  }

  return table(
    ["When", "Event", "Summary", "IP"],
    items.map((item) => [
      formatDateTime(item.createdAt),
      item.eventType || "event",
      item.summary || "—",
      item.ip || "—"
    ])
  );
}

function twoFactorMarkup(twoFactor = {}) {
  return `
    <div class="admin-security-2fa">
      <div class="admin-security-2fa-status">
        <div>
          <strong>Status</strong>
          <p>${escapeHtml(twoFactor.status || "disabled")}</p>
        </div>
        <div>
          <strong>Method</strong>
          <p>${escapeHtml(twoFactor.method || "Not configured")}</p>
        </div>
        <div>
          <strong>Architecture</strong>
          <p>${twoFactor.prepared ? "Prepared" : "Pending"}</p>
        </div>
      </div>
      <div class="admin-security-2fa-placeholders">
        <div class="admin-security-placeholder-block">
          <strong>Authenticator QR</strong>
          <div class="admin-security-qr-placeholder" aria-hidden="true">QR</div>
          <p>QR enrollment placeholder for future TOTP setup.</p>
        </div>
        <div class="admin-security-placeholder-block">
          <strong>Recovery Codes</strong>
          <ul class="bullet-list">
            <li>••••••-••••••</li>
            <li>••••••-••••••</li>
            <li>••••••-••••••</li>
          </ul>
          <p>Recovery code storage is reserved and inactive until 2FA ships.</p>
        </div>
      </div>
      <div class="admin-security-toolbar">
        <button class="btn btn-primary" type="button" id="enableTwoFactorBtn">Enable 2FA (Preview)</button>
        <button class="btn btn-ghost" type="button" id="disableTwoFactorBtn">Disable 2FA (Preview)</button>
      </div>
      <p class="admin-profile-help" id="twoFactorFeedback">${escapeHtml(twoFactor.message || "Two-factor authentication will be fully implemented in a future update.")}</p>
    </div>
  `;
}

function securityMarkup(overview, historyPayload, historyState, eventsPayload) {
  return `
    <div class="admin-profile-page admin-security-page" id="adminSecurityPage">
      <section class="admin-profile-hero">
        <div class="admin-profile-hero-copy">
          <p class="admin-profile-kicker">Administrator security center</p>
          <h3>Session, device, and access monitoring</h3>
          <p class="admin-profile-username">Review active sessions, login history, trusted devices, and security events.</p>
        </div>
        <div class="admin-profile-hero-meta">
          <div class="admin-profile-meta-item"><span>Active Sessions</span><strong>${escapeHtml((overview.sessions || []).length)}</strong></div>
          <div class="admin-profile-meta-item"><span>Trusted Devices</span><strong>${escapeHtml((overview.trustedDevices || []).length)}</strong></div>
          <div class="admin-profile-meta-item"><span>Security Events</span><strong>${escapeHtml((eventsPayload.items || overview.events || []).length)}</strong></div>
          <div class="admin-profile-meta-item"><span>2FA Status</span><strong>${escapeHtml(overview.twoFactor?.status || "disabled")}</strong></div>
        </div>
      </section>

      <div class="admin-profile-grid admin-security-grid">
        ${sectionCard("Active Sessions", "Devices currently signed into the admin workspace.", `<div id="securitySessionsPanel">${sessionsMarkup(overview.sessions || [])}</div>`)}
        ${sectionCard("Trusted Devices", "Browsers and devices marked as familiar for this administrator.", `<div id="securityDevicesPanel">${trustedDevicesMarkup(overview.trustedDevices || [])}</div>`)}
        <section class="admin-profile-card admin-profile-card-wide admin-security-card">
          <header class="admin-profile-card-header">
            <div>
              <h4>Login History</h4>
              <p>Complete authentication history loaded from the database.</p>
            </div>
          </header>
          <div id="securityLoginHistoryPanel">${loginHistoryMarkup(historyPayload, historyState)}</div>
        </section>
        <section class="admin-profile-card admin-security-card">
          <header class="admin-profile-card-header">
            <div>
              <h4>Security Events</h4>
              <p>Password, profile, session, and access audit trail.</p>
            </div>
          </header>
          <div id="securityEventsPanel">${eventsMarkup(eventsPayload.items || overview.events || [])}</div>
        </section>
        <section class="admin-profile-card admin-security-card">
          <header class="admin-profile-card-header">
            <div>
              <h4>Two-Factor Authentication</h4>
              <p>Prepared architecture for future authenticator enrollment.</p>
            </div>
          </header>
          ${twoFactorMarkup(overview.twoFactor || {})}
        </section>
      </div>
      <p id="adminSecurityFeedback" class="form-feedback"></p>
    </div>
  `;
}

async function loadHistory(state) {
  return getAdminLoginHistory({
    query: state.query,
    status: state.status === "all" ? "" : state.status,
    page: state.page,
    limit: state.limit,
    sort: state.sort
  });
}

export async function renderAdminSecurityPanel(container) {
  const historyState = {
    query: "",
    status: "all",
    sort: "created_at_desc",
    page: 1,
    limit: 10
  };

  let overview;
  let historyPayload;
  let eventsPayload;

  try {
    [overview, historyPayload, eventsPayload] = await Promise.all([
      getAdminSecurityOverview({ force: true }),
      loadHistory(historyState),
      getAdminSecurityEvents({ page: 1, limit: 30 })
    ]);
  } catch (error) {
    container.innerHTML = panel(
      "Security",
      "Access and session security controls",
      emptyState(error?.message || "Unable to load security center.")
    );
    return;
  }

  container.innerHTML = panel(
    "Security",
    "Enterprise session, device, and authentication controls",
    securityMarkup(overview, historyPayload, historyState, eventsPayload)
  );

  const feedback = document.getElementById("adminSecurityFeedback");
  const setFeedback = (message) => {
    if (feedback) feedback.textContent = message || "";
  };

  const refreshSessionsAndDevices = async () => {
    overview = await getAdminSecurityOverview({ force: true });
    const sessionsPanel = document.getElementById("securitySessionsPanel");
    const devicesPanel = document.getElementById("securityDevicesPanel");
    if (sessionsPanel) sessionsPanel.innerHTML = sessionsMarkup(overview.sessions || []);
    if (devicesPanel) devicesPanel.innerHTML = trustedDevicesMarkup(overview.trustedDevices || []);
    bindSessionActions();
    bindDeviceActions();
  };

  const refreshHistory = async () => {
    historyPayload = await loadHistory(historyState);
    const panelNode = document.getElementById("securityLoginHistoryPanel");
    if (panelNode) {
      panelNode.innerHTML = loginHistoryMarkup(historyPayload, historyState);
      bindHistoryActions();
    }
  };

  const refreshEvents = async () => {
    eventsPayload = await getAdminSecurityEvents({ page: 1, limit: 30 });
    const panelNode = document.getElementById("securityEventsPanel");
    if (panelNode) {
      panelNode.innerHTML = eventsMarkup(eventsPayload.items || []);
    }
  };

  function bindHistoryActions() {
    document.getElementById("loginHistoryApply")?.addEventListener("click", async () => {
      historyState.query = String(document.getElementById("loginHistorySearch")?.value || "").trim();
      historyState.status = String(document.getElementById("loginHistoryStatus")?.value || "all");
      historyState.sort = String(document.getElementById("loginHistorySort")?.value || "created_at_desc");
      historyState.page = 1;
      setFeedback("Loading login history...");
      try {
        await refreshHistory();
        setFeedback("");
      } catch (error) {
        setFeedback(error?.message || "Unable to load login history.");
      }
    });

    document.getElementById("loginHistoryPrev")?.addEventListener("click", async () => {
      historyState.page = Math.max(1, historyState.page - 1);
      await refreshHistory();
    });

    document.getElementById("loginHistoryNext")?.addEventListener("click", async () => {
      const totalPages = Number(historyPayload?.pagination?.totalPages || 1);
      historyState.page = Math.min(totalPages, historyState.page + 1);
      await refreshHistory();
    });
  }

  function bindSessionActions() {
    document.getElementById("logoutOtherSessionsBtn")?.addEventListener("click", async () => {
      if (!window.confirm("Logout all other administrator sessions? This device will stay signed in.")) {
        return;
      }
      setFeedback("Ending other sessions...");
      try {
        const result = await logoutOtherAdminSessions();
        setFeedback(result?.message || "Other sessions ended.");
        await refreshSessionsAndDevices();
        await refreshEvents();
      } catch (error) {
        setFeedback(error?.message || "Unable to end other sessions.");
      }
    });

    container.querySelectorAll("[data-logout-session]").forEach((button) => {
      button.addEventListener("click", async () => {
        const sessionId = button.getAttribute("data-logout-session");
        if (!sessionId || !window.confirm("End this administrator session?")) return;
        setFeedback("Ending session...");
        try {
          await terminateAdminSession(sessionId, { confirmCurrent: false });
          setFeedback("Session ended.");
          await refreshSessionsAndDevices();
          await refreshEvents();
        } catch (error) {
          setFeedback(error?.message || "Unable to end session.");
        }
      });
    });

    container.querySelectorAll("[data-logout-current]").forEach((button) => {
      button.addEventListener("click", async () => {
        const sessionId = button.getAttribute("data-logout-current");
        if (!sessionId) return;
        if (!window.confirm("Logout the current session? You will be signed out of the admin dashboard.")) {
          return;
        }
        setFeedback("Ending current session...");
        try {
          await terminateAdminSession(sessionId, { confirmCurrent: true });
          logout();
        } catch (error) {
          setFeedback(error?.message || "Unable to end current session.");
        }
      });
    });
  }

  function bindDeviceActions() {
    document.getElementById("trustCurrentDeviceBtn")?.addEventListener("click", async () => {
      const name = window.prompt("Name this trusted device", "This browser");
      if (name == null) return;
      setFeedback("Trusting device...");
      try {
        await trustCurrentAdminDevice({ deviceName: String(name || "Trusted device").trim() });
        setFeedback("Device trusted.");
        await refreshSessionsAndDevices();
        await refreshEvents();
      } catch (error) {
        setFeedback(error?.message || "Unable to trust device.");
      }
    });

    container.querySelectorAll("[data-rename-device]").forEach((button) => {
      button.addEventListener("click", async () => {
        const deviceId = button.getAttribute("data-rename-device");
        const currentName = button.closest(".admin-security-device")?.querySelector(".admin-security-device-name")?.textContent || "Trusted device";
        const nextName = window.prompt("Rename trusted device", currentName);
        if (nextName == null) return;
        setFeedback("Renaming device...");
        try {
          await renameAdminTrustedDevice(deviceId, String(nextName).trim());
          setFeedback("Device renamed.");
          await refreshSessionsAndDevices();
          await refreshEvents();
        } catch (error) {
          setFeedback(error?.message || "Unable to rename device.");
        }
      });
    });

    container.querySelectorAll("[data-remove-device]").forEach((button) => {
      button.addEventListener("click", async () => {
        const deviceId = button.getAttribute("data-remove-device");
        if (!deviceId || !window.confirm("Remove this trusted device?")) return;
        setFeedback("Removing trusted device...");
        try {
          await removeAdminTrustedDevice(deviceId);
          setFeedback("Trusted device removed.");
          await refreshSessionsAndDevices();
          await refreshEvents();
        } catch (error) {
          setFeedback(error?.message || "Unable to remove device.");
        }
      });
    });
  }

  document.getElementById("enableTwoFactorBtn")?.addEventListener("click", async () => {
    const twoFactorFeedback = document.getElementById("twoFactorFeedback");
    try {
      const result = await updateAdminTwoFactorPlaceholder(true);
      if (twoFactorFeedback) twoFactorFeedback.textContent = result.message || "2FA preview recorded.";
      await refreshEvents();
    } catch (error) {
      if (twoFactorFeedback) twoFactorFeedback.textContent = error?.message || "Unable to update 2FA placeholder.";
    }
  });

  document.getElementById("disableTwoFactorBtn")?.addEventListener("click", async () => {
    const twoFactorFeedback = document.getElementById("twoFactorFeedback");
    try {
      const result = await updateAdminTwoFactorPlaceholder(false);
      if (twoFactorFeedback) twoFactorFeedback.textContent = result.message || "2FA preview updated.";
      await refreshEvents();
    } catch (error) {
      if (twoFactorFeedback) twoFactorFeedback.textContent = error?.message || "Unable to update 2FA placeholder.";
    }
  });

  bindSessionActions();
  bindDeviceActions();
  bindHistoryActions();
}
