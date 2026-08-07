import { emptyState, escapeHtml, formatDate, panel, table } from "../components/ui.js";
import {
  getAdminSecurityEvents,
  getAdminSecurityOverview,
  getAdminSessionPolicy,
  logoutAllAdminSessions,
  logoutOtherAdminSessions,
  logoutSelectedAdminSessions,
  terminateAdminSession,
  updateAdminSessionPolicy
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

function splitDateTime(value) {
  if (!value) return { date: "—", time: "—" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "—", time: "—" };
  return {
    date: formatDate(date),
    time: date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  };
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
    : (normalized === "failed" || normalized === "revoked" || normalized === "expired" ? "danger" : "info");
  return `<span class="admin-profile-chip admin-profile-chip-${tone}">${escapeHtml(status || "—")}</span>`;
}

function sectionCard(title, subtitle, body, wide = false) {
  return `
    <section class="admin-profile-card${wide ? " admin-profile-card-wide" : ""} admin-security-card">
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

function actionLabel(eventType) {
  const map = {
    successful_login: "Login",
    failed_login: "Login Failed",
    session_removed: "Logout",
    forced_logout: "Forced Logout",
    session_expired: "Session Expired",
    password_changed: "Password Change",
    security_settings_changed: "Security Change",
    new_device_login: "New Device Login"
  };
  return map[String(eventType || "").toLowerCase()] || (eventType || "Event");
}

function currentSessionMarkup(overview) {
  const admin = overview?.administrator || {};
  const session = overview?.currentSession || {};
  const hasSession = Boolean(session?.sessionId || overview?.currentSessionId);

  if (!hasSession) {
    return emptyState("Current session details are unavailable. Legacy tokens may still be active until the next sign-in.");
  }

  return `
    <div class="admin-logout-current ${session.isCurrent !== false ? "is-current" : ""}">
      <div class="admin-logout-current-grid">
        <div><span>Administrator</span><strong>${escapeHtml(admin.name || admin.email || "—")}</strong></div>
        <div><span>Role</span><strong>${escapeHtml(admin.role || "admin")}</strong></div>
        <div><span>Device</span><strong>${escapeHtml(session.deviceName || "Unknown device")}</strong></div>
        <div><span>Browser</span><strong>${escapeHtml(session.browser || "—")}</strong></div>
        <div><span>Operating System</span><strong>${escapeHtml(session.os || "—")}</strong></div>
        <div><span>IP Address</span><strong>${escapeHtml(session.ip || "—")}</strong></div>
        <div><span>Login Time</span><strong>${escapeHtml(formatDateTime(session.createdAt))}</strong></div>
        <div><span>Last Activity</span><strong>${escapeHtml(formatDateTime(session.lastActivityAt))}</strong></div>
        <div><span>Expires</span><strong>${escapeHtml(formatDateTime(session.expiresAt))}</strong></div>
        <div><span>Session Status</span>${statusChip(session.status || "active")}</div>
      </div>
      <div class="admin-security-toolbar admin-logout-actions">
        <button class="btn btn-primary" type="button" id="logoutCurrentDeviceBtn">Logout Current Device</button>
        <button class="btn btn-ghost" type="button" id="clearCurrentSessionBtn">Clear Current Session</button>
      </div>
      <p class="admin-profile-help">Logout clears the authentication token, local session data, and redirects to Admin Login.</p>
    </div>
  `;
}

function sessionsMarkup(sessions = []) {
  if (!sessions.length) {
    return emptyState("No active sessions found.");
  }

  return `
    <div class="admin-security-toolbar admin-logout-session-toolbar">
      <button class="btn btn-ghost" type="button" id="refreshSessionsBtn">Refresh Session List</button>
      <button class="btn btn-ghost" type="button" id="logoutSelectedBtn">Logout Selected Session</button>
      <button class="btn btn-ghost" type="button" id="logoutOtherSessionsBtn">Logout All Other Sessions</button>
      <button class="btn btn-primary" type="button" id="logoutAllDevicesBtn">Logout All Devices</button>
    </div>
    <div class="admin-security-session-list">
      ${sessions.map((session) => `
        <article class="admin-security-session ${session.isCurrent ? "is-current" : ""}" data-session-id="${attr(session.sessionId)}">
          <label class="admin-logout-select">
            <input type="checkbox" data-session-select value="${attr(session.sessionId)}" ${session.isCurrent ? 'data-is-current="true"' : ""} />
          </label>
          <div class="admin-security-session-main">
            <div class="admin-security-session-title">
              <strong>${escapeHtml(session.deviceName || "Unknown device")}</strong>
              ${session.isCurrent ? '<span class="admin-profile-chip admin-profile-chip-success">Current session</span>' : ""}
              ${statusChip(session.status || "active")}
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
              ? `<button class="btn btn-ghost" type="button" data-logout-current="${attr(session.sessionId)}">Logout Current</button>`
              : `<button class="btn btn-ghost" type="button" data-logout-session="${attr(session.sessionId)}">Logout Session</button>`}
          </div>
        </article>
      `).join("")}
    </div>
    <p class="admin-profile-help">Terminating the current session always requires explicit confirmation. Selected logout never ends the current session unless you confirm.</p>
  `;
}

function policyMarkup(policy = {}) {
  return `
    <form class="settings-form admin-logout-policy-form" id="adminSessionPolicyForm">
      <label>
        <span>Session Duration (hours)</span>
        <input name="sessionDurationHours" type="number" min="1" max="720" step="1" value="${attr(policy.sessionDurationHours || 168)}" />
        <small>JWT and server session lifetime for new logins (1–720 hours).</small>
      </label>
      <label>
        <span>Idle Timeout (hours)</span>
        <input name="idleTimeoutHours" type="number" min="1" max="168" step="1" value="${attr(policy.idleTimeoutHours || 8)}" />
        <small>Client-side inactivity limit before redirect to login (1–168 hours).</small>
      </label>
      <label class="admin-general-toggle admin-logout-span-2">
        <input type="checkbox" name="enforceServerExpiry" ${policy.enforceServerExpiry !== false ? "checked" : ""} />
        <span>Enforce server-side session expiry (expired sessions cannot call protected APIs)</span>
      </label>
      <div class="admin-logout-span-2 admin-security-toolbar">
        <button class="btn btn-primary" type="submit">Save Expiration Policy</button>
      </div>
    </form>
  `;
}

function auditMarkup(items = [], adminEmail = "") {
  if (!items.length) {
    return emptyState("No session audit events recorded yet.");
  }

  return table(
    ["Date", "Time", "User", "Device", "IP Address", "Action", "Status"],
    items.map((item) => {
      const when = splitDateTime(item.createdAt);
      const meta = item.meta && typeof item.meta === "object" ? item.meta : {};
      const device = meta.deviceName || meta.browser || meta.os || item.userAgent?.slice(0, 48) || "—";
      const type = String(item.eventType || "").toLowerCase();
      const status = type.includes("fail") ? "failed" : "success";
      return [
        when.date,
        when.time,
        item.adminEmail || adminEmail || "—",
        device,
        item.ip || "—",
        actionLabel(item.eventType),
        { html: statusChip(status) }
      ];
    })
  );
}

function logoutMarkup(overview, eventsPayload, policy) {
  const sessions = overview?.sessions || [];
  const events = eventsPayload?.items || overview?.events || [];

  return `
    <div class="admin-profile-page admin-logout-page" id="adminLogoutPage">
      <section class="admin-profile-hero">
        <div class="admin-profile-hero-main">
          <div class="admin-profile-hero-copy">
            <p class="admin-profile-kicker">Authentication control</p>
            <h3>Logout & Session Management</h3>
            <p class="admin-profile-username">Manage active sessions, secure logout, expiration, and audit history</p>
            <div class="admin-profile-chip-row">
              <span class="admin-profile-chip admin-profile-chip-success">${escapeHtml(sessions.length)} active</span>
              <span class="admin-profile-chip">${escapeHtml(policy?.sessionDurationHours || 168)}h token lifetime</span>
              <span class="admin-profile-chip">${escapeHtml(policy?.idleTimeoutHours || 8)}h idle timeout</span>
            </div>
          </div>
        </div>
      </section>

      <div class="admin-profile-grid">
        ${sectionCard("Current Session", "This device’s authenticated administrator session.", currentSessionMarkup(overview), true)}
        ${sectionCard("Active Sessions", "Every active administrator session across devices.", `<div id="logoutSessionsPanel">${sessionsMarkup(sessions)}</div>`, true)}
        ${sectionCard("Session Expiration", "Configurable lifetime for new logins and client idle timeout.", `<div id="logoutPolicyPanel">${policyMarkup(policy)}</div>`)}
        ${sectionCard(
          "Audit Log",
          "Login, logout, forced logout, expiration, password, and security events.",
          `<div id="logoutAuditPanel">${auditMarkup(events, overview?.administrator?.email || "")}</div>`,
          true
        )}
      </div>

      <div class="admin-profile-form-actions admin-logout-footer-actions">
        <button class="btn btn-primary" type="button" id="logoutAndRedirectBtn">Logout & Go to Login</button>
        <button class="btn btn-ghost" type="button" id="removeAuthTokenBtn">Remove Authentication Token</button>
        <p id="adminLogoutFeedback" class="form-feedback" role="status"></p>
      </div>
    </div>
  `;
}

function performLocalLogout() {
  logout();
}

export async function renderAdminLogoutPanel(container) {
  container.innerHTML = panel(
    "Admin Settings",
    "Loading session management...",
    `<p class="admin-profile-help">Fetching active sessions and audit records…</p>`
  );

  let overview;
  let eventsPayload;
  let policy;

  try {
    [overview, eventsPayload, policy] = await Promise.all([
      getAdminSecurityOverview({ force: true }),
      getAdminSecurityEvents({ page: 1, limit: 40 }),
      getAdminSessionPolicy()
    ]);
    policy = policy || overview?.sessionPolicy || {};
  } catch (error) {
    container.innerHTML = panel(
      "Logout & Session Management",
      "Administrator session controls",
      emptyState(error?.message || "Unable to load session management.")
    );
    return;
  }

  container.innerHTML = panel(
    "Admin Settings",
    "Secure logout, sessions, expiration, and audit trail",
    logoutMarkup(overview, eventsPayload, policy)
  );

  const feedback = container.querySelector("#adminLogoutFeedback");
  const setFeedback = (message, tone = "") => {
    if (!feedback) return;
    feedback.textContent = message || "";
    feedback.classList.remove("is-error", "is-success");
    if (tone) feedback.classList.add(tone);
  };

  async function refreshAll() {
    overview = await getAdminSecurityOverview({ force: true });
    eventsPayload = await getAdminSecurityEvents({ page: 1, limit: 40 });
    policy = overview.sessionPolicy || (await getAdminSessionPolicy());
    container.innerHTML = panel(
      "Admin Settings",
      "Secure logout, sessions, expiration, and audit trail",
      logoutMarkup(overview, eventsPayload, policy)
    );
    bindLogoutPanel();
  }

  function bindLogoutPanel() {
    const sessionsPanel = container.querySelector("#logoutSessionsPanel");

    container.querySelector("#refreshSessionsBtn")?.addEventListener("click", async () => {
      setFeedback("Refreshing sessions...");
      try {
        await refreshAll();
        setFeedback("Session list refreshed.", "is-success");
      } catch (error) {
        setFeedback(error?.message || "Unable to refresh sessions.", "is-error");
      }
    });

    container.querySelector("#logoutOtherSessionsBtn")?.addEventListener("click", async () => {
      if (!window.confirm("Logout all other administrator sessions? This device will stay signed in.")) {
        return;
      }
      setFeedback("Ending other sessions...");
      try {
        const result = await logoutOtherAdminSessions();
        setFeedback(result?.message || "Other sessions ended.", "is-success");
        await refreshAll();
      } catch (error) {
        setFeedback(error?.message || "Unable to end other sessions.", "is-error");
      }
    });

    container.querySelector("#logoutSelectedBtn")?.addEventListener("click", async () => {
      const selected = Array.from(container.querySelectorAll("[data-session-select]:checked"));
      if (!selected.length) {
        setFeedback("Select at least one session first.", "is-error");
        return;
      }
      const ids = selected.map((node) => node.value);
      const includesCurrent = selected.some((node) => node.getAttribute("data-is-current") === "true");
      if (includesCurrent) {
        if (!window.confirm("Your selection includes the current session. Continue and sign out of this device?")) {
          return;
        }
      } else if (!window.confirm(`Logout ${ids.length} selected session(s)?`)) {
        return;
      }

      setFeedback("Ending selected sessions...");
      try {
        const result = await logoutSelectedAdminSessions(ids, { confirmCurrent: includesCurrent });
        if (result?.endedCurrent) {
          setFeedback("Current session ended. Redirecting...");
          performLocalLogout();
          return;
        }
        setFeedback(result?.message || "Selected sessions ended.", "is-success");
        await refreshAll();
      } catch (error) {
        setFeedback(error?.message || "Unable to end selected sessions.", "is-error");
      }
    });

    container.querySelector("#logoutAllDevicesBtn")?.addEventListener("click", async () => {
      if (!window.confirm("Logout ALL devices including this one? You will be signed out immediately.")) {
        return;
      }
      if (!window.confirm("Final confirmation: end every active administrator session?")) {
        return;
      }
      setFeedback("Logging out all devices...");
      try {
        await logoutAllAdminSessions({ confirmAll: true });
        setFeedback("All devices logged out. Redirecting...");
        performLocalLogout();
      } catch (error) {
        setFeedback(error?.message || "Unable to logout all devices.", "is-error");
      }
    });

    const endCurrent = async (prompt) => {
      const sessionId = overview?.currentSession?.sessionId || overview?.currentSessionId;
      if (!sessionId) {
        performLocalLogout();
        return;
      }
      if (!window.confirm(prompt)) return;
      setFeedback("Ending current session...");
      try {
        await terminateAdminSession(sessionId, { confirmCurrent: true });
      } catch (_error) {
        // Continue local cleanup even if revoke fails.
      }
      performLocalLogout();
    };

    container.querySelector("#logoutCurrentDeviceBtn")?.addEventListener("click", () => {
      endCurrent("Logout the current device? You will be redirected to Admin Login.");
    });
    container.querySelector("#clearCurrentSessionBtn")?.addEventListener("click", () => {
      endCurrent("Clear the current session and remove local authentication data?");
    });
    container.querySelector("#logoutAndRedirectBtn")?.addEventListener("click", () => {
      endCurrent("Logout and redirect to Admin Login?");
    });
    container.querySelector("#removeAuthTokenBtn")?.addEventListener("click", () => {
      endCurrent("Remove the authentication token and end this session?");
    });

    sessionsPanel?.querySelectorAll("[data-logout-session]").forEach((button) => {
      button.addEventListener("click", async () => {
        const sessionId = button.getAttribute("data-logout-session");
        if (!sessionId || !window.confirm("End this administrator session?")) return;
        setFeedback("Ending session...");
        try {
          await terminateAdminSession(sessionId, { confirmCurrent: false });
          setFeedback("Session ended.", "is-success");
          await refreshAll();
        } catch (error) {
          setFeedback(error?.message || "Unable to end session.", "is-error");
        }
      });
    });

    sessionsPanel?.querySelectorAll("[data-logout-current]").forEach((button) => {
      button.addEventListener("click", () => {
        endCurrent("Logout the current session? You will be signed out of the admin dashboard.");
      });
    });

    container.querySelector("#adminSessionPolicyForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      setFeedback("Saving expiration policy...");
      try {
        policy = await updateAdminSessionPolicy({
          sessionDurationHours: Number(data.get("sessionDurationHours") || 168),
          idleTimeoutHours: Number(data.get("idleTimeoutHours") || 8),
          enforceServerExpiry: Boolean(form.querySelector('[name="enforceServerExpiry"]')?.checked)
        });
        try {
          window.localStorage.setItem("adminIdleTimeoutMs", String((policy.idleTimeoutHours || 8) * 60 * 60 * 1000));
        } catch (_error) {
          // ignore
        }
        setFeedback("Session expiration policy saved. New logins use the updated lifetime.", "is-success");
        await refreshAll();
      } catch (error) {
        setFeedback(error?.message || "Unable to save session policy.", "is-error");
      }
    });
  }

  bindLogoutPanel();
}
