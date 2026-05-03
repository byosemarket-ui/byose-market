(function () {
  var AUTH_KEY = "adminAuth";
  var LOGIN_TIME_KEY = "adminLoginTime";
  var ADMIN_EMAIL_KEY = "adminEmail";
  var DEFAULT_SESSION_MS = 8 * 60 * 60 * 1000;

  function safeStorageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (_error) {
      return null;
    }
  }

  function safeStorageRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (_error) {
      // Ignore storage failures and continue with redirect safety.
    }
  }

  function getSessionDurationMs() {
    var raw = (window.ADMIN_SESSION_DURATION_MS || "").toString().trim();
    var parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    return DEFAULT_SESSION_MS;
  }

  function getAdminBasePath() {
    var path = String(window.location.pathname || "").replace(/\\/g, "/");
    var marker = "/admin/";
    var markerIndex = path.toLowerCase().indexOf(marker);

    if (markerIndex !== -1) {
      return path.slice(0, markerIndex + marker.length);
    }

    return "/admin/";
  }

  function normalizeAbsoluteUrl(url) {
    try {
      var parsed = new URL(url, window.location.origin);
      parsed.hash = "";
      return parsed.href.replace(/\/$/, "");
    } catch (_error) {
      return String(url || "").replace(/#.*$/, "").replace(/\/$/, "");
    }
  }

  function getLoginUrl() {
    return window.location.origin + getAdminBasePath() + "admin-login.html";
  }

  function getNestedLoginUrl() {
    return window.location.origin + getAdminBasePath() + "admin-login/admin-login.html";
  }

  function getDashboardUrl() {
    return window.location.origin + getAdminBasePath() + "dashboard.html";
  }

  function clearAuth() {
    safeStorageRemove(AUTH_KEY);
    safeStorageRemove(LOGIN_TIME_KEY);
    safeStorageRemove(ADMIN_EMAIL_KEY);

    try {
      window.sessionStorage.clear();
    } catch (_error) {
      // Ignore session storage failures and continue with redirect safety.
    }
  }

  function logout() {
    clearAuth();

    try {
      document.documentElement.style.visibility = "hidden";
    } catch (_error) {
      // Ignore DOM visibility failures and continue with redirect safety.
    }

    try {
      window.history.replaceState(null, "", getLoginUrl());
    } catch (_error) {
      // Ignore history errors and continue with redirect safety.
    }

    redirectToLogin();
    return true;
  }

  function hasValidSession() {
    var authFlag = safeStorageGet(AUTH_KEY);
    var loginTimeRaw = safeStorageGet(LOGIN_TIME_KEY);

    if (authFlag !== "true" || !loginTimeRaw) {
      return false;
    }

    var loginTime = new Date(loginTimeRaw).getTime();
    if (!Number.isFinite(loginTime)) {
      clearAuth();
      return false;
    }

    var now = Date.now();
    var duration = getSessionDurationMs();

    if (now - loginTime > duration) {
      clearAuth();
      return false;
    }

    return true;
  }

  function redirectToLogin() {
    var loginUrl = getLoginUrl();
    if (normalizeAbsoluteUrl(window.location.href) !== normalizeAbsoluteUrl(loginUrl)) {
      window.location.replace(loginUrl);
    }
  }

  function redirectToDashboard() {
    var dashboardUrl = getDashboardUrl();
    if (window.location.href !== dashboardUrl) {
      window.location.replace(dashboardUrl);
    }
  }

  function isLoginPage() {
    var path = String(window.location.pathname || "").replace(/\\/g, "/").toLowerCase();
    return path.indexOf("/admin/admin-login.html") !== -1 || path.indexOf("/admin/admin-login/admin-login.html") !== -1;
  }

  function protectPage() {
    var root = document.documentElement;
    var previousVisibility = root.style.visibility;
    root.style.visibility = "hidden";

    var authenticated = hasValidSession();
    var onLoginPage = isLoginPage();

    if (!authenticated && !onLoginPage) {
      redirectToLogin();
      return false;
    }

    if (authenticated && onLoginPage) {
      redirectToDashboard();
      return false;
    }

    root.style.visibility = previousVisibility || "visible";
    return true;
  }

  function requireAuth() {
    if (!hasValidSession()) {
      redirectToLogin();
      return false;
    }
    return true;
  }

  window.AdminSecurity = {
    isAuthenticated: hasValidSession,
    requireAuth: requireAuth,
    clearAuth: clearAuth,
    logout: logout,
    redirectToLogin: redirectToLogin,
    redirectToDashboard: redirectToDashboard,
    getLoginUrl: getLoginUrl,
    getDashboardUrl: getDashboardUrl,
    protectPage: protectPage
  };

  window.addEventListener("pageshow", function () {
    protectPage();
  });

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || typeof target.closest !== "function") {
      return;
    }

    var logoutTrigger = target.closest("[data-admin-logout]");
    if (!logoutTrigger) {
      return;
    }

    event.preventDefault();
    logout();
  });

  protectPage();
})();
