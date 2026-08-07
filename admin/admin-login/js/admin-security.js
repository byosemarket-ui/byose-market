(function () {
  var AUTH_KEY = "adminAuth";
  var LOGIN_TIME_KEY = "adminLoginTime";
  var ADMIN_EMAIL_KEY = "adminEmail";
  var ADMIN_TOKEN_KEY = "adminToken";
  var ADMIN_TOKEN_EXPIRY_KEY = "adminTokenExpiresAt";
  var ADMIN_PROFILE_KEY = "adminProfile";
  var ADMIN_SESSION_ID_KEY = "adminSessionId";
  var ADMIN_DEVICE_FINGERPRINT_KEY = "adminDeviceFingerprint";
  var ADMIN_API_BASE_URL_KEY = "adminApiBaseUrl";
  var ADMIN_VALIDATED_API_BASE_URL_KEY = "adminValidatedApiBaseUrl";
  var ADMIN_LAST_VALIDATED_AT_KEY = "adminLastValidatedAt";
  var ADMIN_IDLE_TIMEOUT_KEY = "adminIdleTimeoutMs";
  var DEFAULT_SESSION_MS = 8 * 60 * 60 * 1000;
  var SESSION_VALIDATION_GRACE_MS = 2 * 60 * 1000;
  var SESSION_VALIDATION_TIMEOUT_MS = 10000;
  var PRODUCTION_API_BASE_URL = "https://byosemarket.com/api";
  var LEGACY_API_PATTERN = /(?:onrender\.com|localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i;
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
    var stored = Number(safeStorageGet(ADMIN_IDLE_TIMEOUT_KEY) || "");
    if (Number.isFinite(stored) && stored > 0) {
      return stored;
    }
    return DEFAULT_SESSION_MS;
  }

  function normalizeBaseUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function normalizeApiBaseUrl(value) {
    var normalized = normalizeBaseUrl(value).replace(/\/admin$/i, "");
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
    if (!normalized || isLegacyApiBase(normalized)) {
      normalized = PRODUCTION_API_BASE_URL;
    }

    safeStorageSet(ADMIN_API_BASE_URL_KEY, normalized);
    safeStorageSet(ADMIN_VALIDATED_API_BASE_URL_KEY, normalized);
    window.BYOSE_API_BASE_URL = normalized;
    return normalized;
  }

  function migrateLegacyStoredApiBase() {
    var expectedApiBase = resolveApiBaseUrlFromEnvironment();

    [ADMIN_API_BASE_URL_KEY, ADMIN_VALIDATED_API_BASE_URL_KEY].forEach(function (key) {
      var stored = normalizeApiBaseUrl(safeStorageGet(key));
      if (!stored || isLegacyApiBase(stored)) {
        safeStorageSet(key, expectedApiBase);
      }
    });

    var runtimeOverride = normalizeApiBaseUrl(window.BYOSE_API_BASE_URL || window.__BYOSE_API_BASE__ || "");
    if (!runtimeOverride || isLegacyApiBase(runtimeOverride)) {
      window.BYOSE_API_BASE_URL = expectedApiBase;
    }
  }

  function bootstrapVpsApiBaseEarly() {
    if (window.__BYOSE_ADMIN_API_BOOTSTRAPPED__) {
      return;
    }

    window.__BYOSE_ADMIN_API_BOOTSTRAPPED__ = true;
    migrateLegacyStoredApiBase();
  }

  bootstrapVpsApiBaseEarly();

  function resolveApiBaseUrlFromEnvironment() {
    var protocol = String(window.location.protocol || "").toLowerCase();
    var hostname = String(window.location.hostname || "").trim().toLowerCase();
    var origin = normalizeBaseUrl(window.location.origin || "");

    if ((protocol === "http:" || protocol === "https:") && origin && /byosemarket\.com$/i.test(hostname)) {
      return origin + "/api";
    }

    return PRODUCTION_API_BASE_URL;
  }

  function isLegacyApiBase(value) {
    return LEGACY_API_PATTERN.test(normalizeApiBaseUrl(value));
  }

  function requiresExternalApiBaseUrl(protocol, hostname) {
    return (protocol === "http:" || protocol === "https:")
      && /(^|\.)github\.io$/i.test(String(hostname || ""));
  }

  function resolveApiBaseUrl() {
    var override = normalizeApiBaseUrl(window.BYOSE_API_BASE_URL || window.__BYOSE_API_BASE__ || "");
    if (override && !isLegacyApiBase(override)) {
      return override;
    }

    var validatedApiBaseUrl = readValidatedApiBaseUrl();
    if (validatedApiBaseUrl && !isLegacyApiBase(validatedApiBaseUrl)) {
      return validatedApiBaseUrl;
    }

    var persistedApiBaseUrl = normalizeApiBaseUrl(safeStorageGet(ADMIN_API_BASE_URL_KEY));
    if (persistedApiBaseUrl && !isLegacyApiBase(persistedApiBaseUrl)) {
      return persistedApiBaseUrl;
    }

    if (window.AdminConfig && window.AdminConfig.apiBaseUrl) {
      var configuredApiBaseUrl = normalizeApiBaseUrl(window.AdminConfig.apiBaseUrl);
      if (configuredApiBaseUrl && !isLegacyApiBase(configuredApiBaseUrl)) {
        return configuredApiBaseUrl;
      }
    }

    return resolveApiBaseUrlFromEnvironment();
  }

  function getAdminSessionUrl() {
    return `${resolveApiBaseUrl()}/admin/session`;
  }

  function collectSessionValidationCandidates(preferredApiBaseUrl) {
    var seen = Object.create(null);
    var candidates = [];

    function addCandidate(value) {
      var normalized = normalizeApiBaseUrl(value);
      if (!normalized || seen[normalized] || isLegacyApiBase(normalized)) {
        return;
      }

      seen[normalized] = true;
      candidates.push(normalized);
    }

    addCandidate(PRODUCTION_API_BASE_URL);
    addCandidate(preferredApiBaseUrl);
    addCandidate(readValidatedApiBaseUrl());
    addCandidate(safeStorageGet(ADMIN_API_BASE_URL_KEY));
    addCandidate(window.AdminConfig && window.AdminConfig.apiBaseUrl);

    var protocol = String(window.location.protocol || "").toLowerCase();
    var hostname = String(window.location.hostname || "").trim();
    var origin = normalizeBaseUrl(window.location.origin || "");

    if (protocol === "http:" || protocol === "https:") {
      addCandidate(`${origin}/api`);
    }

    if (requiresExternalApiBaseUrl(protocol, hostname)) {
      addCandidate(PRODUCTION_API_BASE_URL);
    }

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

    if (payload && payload.sessionId) {
      safeStorageSet(ADMIN_SESSION_ID_KEY, String(payload.sessionId));
    }

    if (payload && payload.sessionPolicy && Number(payload.sessionPolicy.idleTimeoutMs) > 0) {
      safeStorageSet(ADMIN_IDLE_TIMEOUT_KEY, String(payload.sessionPolicy.idleTimeoutMs));
    } else if (payload && payload.sessionPolicy && Number(payload.sessionPolicy.sessionDurationMs) > 0) {
      safeStorageSet(ADMIN_IDLE_TIMEOUT_KEY, String(payload.sessionPolicy.sessionDurationMs));
    }

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
      sessionId: safeStorageGet(ADMIN_SESSION_ID_KEY) || "",
      deviceFingerprint: safeStorageGet(ADMIN_DEVICE_FINGERPRINT_KEY) || "",
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

  function getOrCreateDeviceFingerprint() {
    var existing = String(safeStorageGet(ADMIN_DEVICE_FINGERPRINT_KEY) || "").trim();
    if (existing) {
      return existing;
    }

    var seed = [
      String(navigator.userAgent || ""),
      String(navigator.language || ""),
      String(screen && screen.width ? screen.width : ""),
      String(screen && screen.height ? screen.height : ""),
      String(Intl && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : "")
    ].join("|");

    var hash = 2166136261;
    for (var index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }

    var fingerprint = "dev_" + (hash >>> 0).toString(16) + "_" + String(seed.length);
    safeStorageSet(ADMIN_DEVICE_FINGERPRINT_KEY, fingerprint);
    return fingerprint;
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
    safeStorageRemove(ADMIN_SESSION_ID_KEY);
    safeStorageRemove(ADMIN_IDLE_TIMEOUT_KEY);
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
    var token = getStoredToken();
    var sessionId = String(safeStorageGet(ADMIN_SESSION_ID_KEY) || "").trim();
    var apiBase = resolveApiBaseUrl();

    if (token && sessionId && apiBase) {
      try {
        var url = apiBase.replace(/\/+$/, "") + "/admin/security/sessions/" + encodeURIComponent(sessionId) + "?confirmCurrent=true";
        if (globalThis.fetch) {
          fetch(url, {
            method: "DELETE",
            headers: {
              Accept: "application/json",
              Authorization: "Bearer " + token,
              "X-Admin-Session-Id": sessionId
            },
            keepalive: true
          }).catch(function () {});
        }
      } catch (_error) {
        // Ignore revoke failures and continue local logout.
      }
    }

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
    getSessionId: function () {
      return String(safeStorageGet(ADMIN_SESSION_ID_KEY) || "").trim();
    },
    getDeviceFingerprint: getOrCreateDeviceFingerprint,
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
