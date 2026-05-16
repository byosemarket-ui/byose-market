(function () {
  var AUTH_KEY = "adminAuth";
  var LOGIN_TIME_KEY = "adminLoginTime";
  var ADMIN_EMAIL_KEY = "adminEmail";
  var ADMIN_TOKEN_KEY = "adminToken";
  var ADMIN_TOKEN_EXPIRY_KEY = "adminTokenExpiresAt";
  var ADMIN_PROFILE_KEY = "adminProfile";
  var ADMIN_API_BASE_URL_KEY = "adminApiBaseUrl";
  var ADMIN_VALIDATED_API_BASE_URL_KEY = "adminValidatedApiBaseUrl";
  var ADMIN_LAST_VALIDATED_AT_KEY = "adminLastValidatedAt";
  var DEFAULT_SESSION_MS = 8 * 60 * 60 * 1000;
  var SESSION_VALIDATION_GRACE_MS = 2 * 60 * 1000;
  var SESSION_VALIDATION_TIMEOUT_MS = 10000;
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

  function logAuthDebug(level, event, detail) {
    var payload = detail || {};

    try {
      if (window.ByoseDiagnostics) {
        if (level === "error" && typeof window.ByoseDiagnostics.logError === "function") {
          window.ByoseDiagnostics.logError(event, payload);
          return;
        }

        if (level === "warn" && typeof window.ByoseDiagnostics.logWarn === "function") {
          window.ByoseDiagnostics.logWarn(event, payload);
          return;
        }

        if (typeof window.ByoseDiagnostics.logInfo === "function") {
          window.ByoseDiagnostics.logInfo(event, payload);
          return;
        }
      }
    } catch (_error) {
      // Fall back to the console below.
    }

    if (window.console && typeof window.console.debug === "function" && (level === "warn" || level === "error")) {
      window.console.debug("[AdminSecurity] " + event, payload);
      return;
    }

    // No-op when diagnostics hooks are unavailable.
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

  function normalizeApiBaseUrl(value) {
    var normalized = normalizeBaseUrl(value);
    if (!normalized) {
      return "";
    }

    return /\/api$/i.test(normalized) ? normalized : `${normalized}/api`;
  }

  function readValidatedApiBaseUrl() {
    return normalizeApiBaseUrl(safeStorageGet(ADMIN_VALIDATED_API_BASE_URL_KEY));
  }

  function persistResolvedApiBaseUrl(value) {
    var normalized = normalizeApiBaseUrl(value);
    if (!normalized) {
      return "";
    }

    safeStorageSet(ADMIN_API_BASE_URL_KEY, normalized);
    safeStorageSet(ADMIN_VALIDATED_API_BASE_URL_KEY, normalized);
    return normalized;
  }

  function requiresExternalApiBaseUrl(protocol, hostname) {
    return (protocol === "http:" || protocol === "https:")
      && /(^|\.)(github\.io|byosemarket\.com|www\.byosemarket\.com)$/i.test(String(hostname || ""));
  }

  function resolveApiBaseUrl() {
    var override = normalizeApiBaseUrl(window.BYOSE_API_BASE_URL || window.__BYOSE_API_BASE__ || "");
    if (override) {
      return override;
    }

    var validatedApiBaseUrl = readValidatedApiBaseUrl();
    if (validatedApiBaseUrl) {
      return validatedApiBaseUrl;
    }

    var persistedApiBaseUrl = normalizeApiBaseUrl(safeStorageGet(ADMIN_API_BASE_URL_KEY));
    if (persistedApiBaseUrl) {
      return persistedApiBaseUrl;
    }

    if (window.AdminConfig && window.AdminConfig.apiBaseUrl) {
      return normalizeApiBaseUrl(window.AdminConfig.apiBaseUrl);
    }

    var protocol = String(window.location.protocol || "").toLowerCase();
    var hostname = String(window.location.hostname || "").trim();
    var origin = normalizeBaseUrl(window.location.origin || "");

    if (protocol === "file:") {
      return PRODUCTION_API_BASE_URL;
    }

    if (requiresExternalApiBaseUrl(protocol, hostname)) {
      return PRODUCTION_API_BASE_URL;
    }

    return origin ? `${origin}/api` : PRODUCTION_API_BASE_URL;
  }

  function getAdminSessionUrl() {
    return `${resolveApiBaseUrl()}/admin/session`;
  }

  function collectSessionValidationCandidates(preferredApiBaseUrl) {
    var seen = Object.create(null);
    var candidates = [];

    function addCandidate(value) {
      var normalized = normalizeApiBaseUrl(value);
      if (!normalized || seen[normalized]) {
        return;
      }

      seen[normalized] = true;
      candidates.push(normalized);
    }

    addCandidate(preferredApiBaseUrl);
    addCandidate(readValidatedApiBaseUrl());
    addCandidate(safeStorageGet(ADMIN_API_BASE_URL_KEY));
    addCandidate(window.AdminConfig && window.AdminConfig.apiBaseUrl);

    var protocol = String(window.location.protocol || "").toLowerCase();
    var origin = normalizeBaseUrl(window.location.origin || "");
    if (protocol === "http:" || protocol === "https:") {
      addCandidate(`${origin}/api`);
    }

    addCandidate(PRODUCTION_API_BASE_URL);
    return candidates;
  }

  function persistSession(payload, options) {
    var admin = payload && payload.admin && typeof payload.admin === "object" ? payload.admin : null;
    var token = String(payload && payload.token ? payload.token : "").trim();
    var apiBaseUrl = normalizeApiBaseUrl(
      (options && options.apiBaseUrl)
      || (payload && payload.apiBaseUrl)
      || resolveApiBaseUrl()
    );

    if (!admin || !token || String(admin.role || "").toLowerCase() !== "admin") {
      clearAuth();
      return false;
    }

    safeStorageSet(AUTH_KEY, "true");
    safeStorageSet(LOGIN_TIME_KEY, new Date().toISOString());
    safeStorageSet(ADMIN_EMAIL_KEY, String((options && options.loginEmail) || admin.email || ""));
    safeStorageSet(ADMIN_TOKEN_KEY, token);

    if (payload && payload.expiresAt) {
      safeStorageSet(ADMIN_TOKEN_EXPIRY_KEY, payload.expiresAt);
    } else {
      safeStorageRemove(ADMIN_TOKEN_EXPIRY_KEY);
    }

    safeStorageSet(ADMIN_PROFILE_KEY, JSON.stringify(admin));

    if (apiBaseUrl) {
      persistResolvedApiBaseUrl(apiBaseUrl);
    }

    safeStorageSet(ADMIN_LAST_VALIDATED_AT_KEY, new Date().toISOString());

    logAuthDebug("info", "auth.session.persisted", {
      adminEmail: String(admin.email || ""),
      hasToken: Boolean(token),
      expiresAt: payload && payload.expiresAt ? payload.expiresAt : "",
      apiBaseUrl: apiBaseUrl || resolveApiBaseUrl()
    });

    return true;
  }

  function getSessionSnapshot() {
    return {
      authenticated: safeStorageGet(AUTH_KEY) === "true",
      loginTime: safeStorageGet(LOGIN_TIME_KEY),
      email: safeStorageGet(ADMIN_EMAIL_KEY),
      token: getStoredToken(),
      expiresAt: safeStorageGet(ADMIN_TOKEN_EXPIRY_KEY),
      apiBaseUrl: normalizeApiBaseUrl(safeStorageGet(ADMIN_API_BASE_URL_KEY)),
      validatedApiBaseUrl: readValidatedApiBaseUrl(),
      profile: (function () {
        try {
          return JSON.parse(safeStorageGet(ADMIN_PROFILE_KEY) || "null");
        } catch (_error) {
          return null;
        }
      })()
    };
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
    return window.location.origin + getAdminBasePath() + "admin-login/admin-login.html";
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
    safeStorageRemove(ADMIN_API_BASE_URL_KEY);
    safeStorageRemove(ADMIN_VALIDATED_API_BASE_URL_KEY);
    safeStorageRemove(ADMIN_LAST_VALIDATED_AT_KEY);

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

    var tokenPayload = decodeTokenPayload(adminToken);
    if (!tokenPayload || String(tokenPayload.role || "").toLowerCase() !== "admin") {
      clearAuth();
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
    var options = arguments.length > 1 && arguments[1] ? arguments[1] : {};
    if (!hasValidSession()) {
      logAuthDebug("warn", "auth.session.local_state_invalid", {
        source: options.source || "guard",
        snapshot: getSessionSnapshot()
      });
      return false;
    }

    if (validationPromise && !force) {
      return validationPromise;
    }

    validationPromise = (async function () {
      var authToken = getStoredToken();
      var candidates = collectSessionValidationCandidates(options.preferredApiBaseUrl);
      var recoverableFailure = false;

      for (var index = 0; index < candidates.length; index += 1) {
        var apiBaseUrl = candidates[index];
        var sessionUrl = `${apiBaseUrl}/admin/session`;

        logAuthDebug("info", "auth.session.validation_attempt", {
          source: options.source || "guard",
          force: Boolean(force),
          apiBaseUrl: apiBaseUrl,
          sessionUrl: sessionUrl,
          hasToken: Boolean(authToken)
        });

        try {
          var requestController = new AbortController();
          var timeoutId = window.setTimeout(function () {
            requestController.abort();
          }, SESSION_VALIDATION_TIMEOUT_MS);

          var response = await fetch(sessionUrl, {
            method: "GET",
            cache: "no-store",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${authToken}`
            },
            signal: requestController.signal
          }).finally(function () {
            window.clearTimeout(timeoutId);
          });

          var payload = await response.json().catch(function () {
            return null;
          });

          if (response.ok && payload && payload.success === true && payload.admin && payload.admin.role === "admin") {
            safeStorageSet(AUTH_KEY, "true");
            safeStorageSet(LOGIN_TIME_KEY, new Date().toISOString());
            safeStorageSet(ADMIN_EMAIL_KEY, String(payload.admin.email || ""));
            safeStorageSet(ADMIN_PROFILE_KEY, JSON.stringify(payload.admin));
            safeStorageSet(ADMIN_LAST_VALIDATED_AT_KEY, new Date().toISOString());
            persistResolvedApiBaseUrl(apiBaseUrl);

            logAuthDebug("info", "auth.session.validation_succeeded", {
              source: options.source || "guard",
              apiBaseUrl: apiBaseUrl,
              adminEmail: String(payload.admin.email || ""),
              adminId: String(payload.admin.id || "")
            });

            return true;
          }

          var responseCode = String(payload && payload.code ? payload.code : "").trim();
          var authFailure = response.status === 401 || response.status === 403
            || responseCode === "ADMIN_TOKEN_MISSING"
            || responseCode === "ADMIN_TOKEN_EXPIRED"
            || responseCode === "ADMIN_TOKEN_INVALID"
            || responseCode === "ADMIN_ROLE_REQUIRED";

          logAuthDebug(authFailure ? "warn" : "info", "auth.session.validation_response", {
            source: options.source || "guard",
            apiBaseUrl: apiBaseUrl,
            status: response.status,
            code: responseCode,
            success: Boolean(payload && payload.success),
            message: String(payload && payload.message ? payload.message : "")
          });

          if (authFailure) {
            clearAuth();
            return false;
          }

          recoverableFailure = true;
        } catch (error) {
          recoverableFailure = true;
          logAuthDebug("warn", "auth.session.validation_transport_failure", {
            source: options.source || "guard",
            apiBaseUrl: apiBaseUrl,
            message: String(error && error.message ? error.message : error)
          });
        }
      }

      if (recoverableFailure) {
        var lastValidatedAt = new Date(String(safeStorageGet(ADMIN_LAST_VALIDATED_AT_KEY) || '')).getTime();
        var nowMs = Date.now();
        var localSessionStillValid = hasValidSession();
        var canGracefullyContinue = localSessionStillValid && (
          !Number.isFinite(lastValidatedAt) || (nowMs - lastValidatedAt) <= SESSION_VALIDATION_GRACE_MS
        );

        logAuthDebug("warn", "auth.session.validation_deferred", {
          source: options.source || "guard",
          candidates: candidates,
          snapshot: getSessionSnapshot(),
          canGracefullyContinue: canGracefullyContinue,
          localSessionStillValid: localSessionStillValid
        });

        if (canGracefullyContinue) {
          return true;
        }

        return localSessionStillValid;
      }

      clearAuth();
      return false;
    })()
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
    var authenticated = hasValidSession();
    var onLoginPage = isLoginPage();

    if (!authenticated && !onLoginPage) {
      redirectToLogin();
      return false;
    }

    if (!authenticated && onLoginPage) {
      return true;
    }

    validateSession()
      .then(function (isValid) {
        if (!isValid) {
          if (!onLoginPage) {
            redirectToLogin();
            return;
          }
          return;
        }

        if (onLoginPage) {
          redirectToDashboard();
          return;
        }
      })
      .catch(function () {
        if (!onLoginPage) {
          redirectToLogin();
          return;
        }
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
    persistSession: persistSession,
    handleUnauthorized: handleUnauthorized,
    logout: logout,
    redirectToLogin: redirectToLogin,
    redirectToDashboard: redirectToDashboard,
    getLoginUrl: getLoginUrl,
    getDashboardUrl: getDashboardUrl,
    getToken: getStoredToken,
    getApiBaseUrl: resolveApiBaseUrl,
    getSessionSnapshot: getSessionSnapshot,
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
