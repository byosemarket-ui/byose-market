(function () {
  var AUTH_KEY = "adminAuth";
  var LOGIN_TIME_KEY = "adminLoginTime";
  var ADMIN_EMAIL_KEY = "adminEmail";
  var ADMIN_TOKEN_KEY = "adminToken";
  var ADMIN_TOKEN_EXPIRY_KEY = "adminTokenExpiresAt";
  var ADMIN_PROFILE_KEY = "adminProfile";
  var DEFAULT_SESSION_MS = 8 * 60 * 60 * 1000;
  var PRODUCTION_API_BASE_URL = "https://byosesemarket4.onrender.com/api";
  var validationPromise = null;

  function safeStorageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (_error) {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (_error) {
      // Ignore storage failures and continue with redirect safety.
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

  function normalizeBaseUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function isLocalHost(hostname) {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
  }

  function requiresExternalApiBaseUrl(protocol, hostname) {
    return (protocol === "http:" || protocol === "https:")
      && /(^|\.)(github\.io|byosemarket\.com|www\.byosemarket\.com)$/i.test(String(hostname || ""));
  }

  function resolveApiBaseUrl() {
    var override = normalizeBaseUrl(window.BYOSE_API_BASE_URL || window.__BYOSE_API_BASE__ || "");
    if (override) {
      return /\/api$/i.test(override) ? override : `${override}/api`;
    }

    if (window.AdminConfig && window.AdminConfig.apiBaseUrl) {
      return normalizeBaseUrl(window.AdminConfig.apiBaseUrl);
    }

    var protocol = String(window.location.protocol || "").toLowerCase();
    var hostname = String(window.location.hostname || "").trim();
    var origin = normalizeBaseUrl(window.location.origin || "");

    if (protocol === "file:" || isLocalHost(hostname)) {
      return `http://${hostname || "localhost"}:5000/api`;
    }

    if (requiresExternalApiBaseUrl(protocol, hostname)) {
      return PRODUCTION_API_BASE_URL;
    }

    return origin ? `${origin}/api` : PRODUCTION_API_BASE_URL;
  }

  function getAdminSessionUrl() {
    return `${resolveApiBaseUrl()}/admin/session`;
  }

  function getStoredToken() {
    return String(safeStorageGet(ADMIN_TOKEN_KEY) || "").trim();
  }

  function decodeTokenPayload(token) {
    if (!token || token.split('.').length < 2) {
      return null;
    }

    try {
      var base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(window.atob(base64));
    } catch (_error) {
      return null;
    }
  }

  function getTokenExpiryMs() {
    var storedExpiry = safeStorageGet(ADMIN_TOKEN_EXPIRY_KEY);
    if (storedExpiry) {
      var parsedStoredExpiry = new Date(storedExpiry).getTime();
      if (Number.isFinite(parsedStoredExpiry)) {
        return parsedStoredExpiry;
      }
    }

    var payload = decodeTokenPayload(getStoredToken());
    if (payload && Number.isFinite(payload.exp)) {
      return payload.exp * 1000;
    }

    return NaN;
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

  function getDashboardUrl() {
    return window.location.origin + getAdminBasePath() + "dashboard.html";
  }

  function clearAuth() {
    safeStorageRemove(AUTH_KEY);
    safeStorageRemove(LOGIN_TIME_KEY);
    safeStorageRemove(ADMIN_EMAIL_KEY);
    safeStorageRemove(ADMIN_TOKEN_KEY);
    safeStorageRemove(ADMIN_TOKEN_EXPIRY_KEY);
    safeStorageRemove(ADMIN_PROFILE_KEY);

    try {
      window.sessionStorage.clear();
    } catch (_error) {
      // Ignore session storage failures and continue with redirect safety.
    }
  }

  function hasValidSession() {
    var authFlag = safeStorageGet(AUTH_KEY);
    var loginTimeRaw = safeStorageGet(LOGIN_TIME_KEY);
    var adminToken = getStoredToken();

    if (authFlag !== "true" || !loginTimeRaw || !adminToken) {
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

    var tokenExpiryMs = getTokenExpiryMs();
    if (Number.isFinite(tokenExpiryMs) && tokenExpiryMs <= now) {
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
    if (normalizeAbsoluteUrl(window.location.href) !== normalizeAbsoluteUrl(dashboardUrl)) {
      window.location.replace(dashboardUrl);
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

  function handleUnauthorized() {
    return logout();
  }

  async function validateSession(force) {
    if (!hasValidSession()) {
      return false;
    }

    if (validationPromise && !force) {
      return validationPromise;
    }

    validationPromise = fetch(getAdminSessionUrl(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${getStoredToken()}`
      }
    })
      .then(async function (response) {
        var payload = await response.json().catch(function () {
          return null;
        });

        if (!response.ok || !payload || payload.success !== true || !payload.admin || payload.admin.role !== "admin") {
          clearAuth();
          return false;
        }

        safeStorageSet(AUTH_KEY, "true");
        safeStorageSet(LOGIN_TIME_KEY, new Date().toISOString());
        safeStorageSet(ADMIN_EMAIL_KEY, String(payload.admin.email || ""));
        safeStorageSet(ADMIN_PROFILE_KEY, JSON.stringify(payload.admin));
        return true;
      })
      .catch(function () {
        clearAuth();
        return false;
      })
      .finally(function () {
        validationPromise = null;
      });

    return validationPromise;
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

    if (!authenticated && onLoginPage) {
      root.style.visibility = previousVisibility || "visible";
      return true;
    }

    validateSession()
      .then(function (isValid) {
        if (!isValid) {
          if (!onLoginPage) {
            redirectToLogin();
            return;
          }

          root.style.visibility = previousVisibility || "visible";
          return;
        }

        if (onLoginPage) {
          redirectToDashboard();
          return;
        }

        root.style.visibility = previousVisibility || "visible";
      })
      .catch(function () {
        if (!onLoginPage) {
          redirectToLogin();
          return;
        }

        root.style.visibility = previousVisibility || "visible";
      });

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
    validateSession: validateSession,
    requireAuth: requireAuth,
    clearAuth: clearAuth,
    handleUnauthorized: handleUnauthorized,
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

  window.addEventListener("storage", function (event) {
    if (!event || !event.key) {
      return;
    }

    if (event.key === AUTH_KEY || event.key === ADMIN_TOKEN_KEY || event.key === LOGIN_TIME_KEY) {
      protectPage();
    }
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
