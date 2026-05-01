(function (global) {
	"use strict";

	const TOKEN_STORAGE_KEY = "adminToken";
	let sessionCache = null;

	// ─── Path helpers ────────────────────────────────────────────────────────────

	function getAdminBasePath() {
		const path = String(global.location?.pathname || "").replace(/\\/g, "/");
		const marker = "/admin/";
		const markerIndex = path.toLowerCase().indexOf(marker);
		return markerIndex !== -1 ? path.slice(0, markerIndex + marker.length) : "/admin/";
	}

	function buildAdminUrl(relativePath) {
		return `${getAdminBasePath()}${String(relativePath || "").replace(/^\/+/, "")}`;
	}

	function getLoginUrl() {
		return buildAdminUrl("login.html");
	}

	function getDashboardUrl() {
		return buildAdminUrl("dashboard.html");
	}

	function isLoginPage() {
		return /\/admin\/login\.html$/i.test(
			String(global.location?.pathname || "").replace(/\\/g, "/")
		);
	}

	function getSessionRedirectPath() {
		const path = String(global.location?.pathname || "").replace(/\\/g, "/");
		const marker = "/admin/";
		const markerIndex = path.toLowerCase().indexOf(marker);
		const adminPath = markerIndex === -1 ? "dashboard.html" : path.slice(markerIndex + marker.length);
		const suffix = `${global.location?.search || ""}${global.location?.hash || ""}`;
		return `${adminPath || "dashboard.html"}${suffix}`;
	}

	function getPostLoginRedirectUrl() {
		const params = new URLSearchParams(global.location?.search || "");
		const redirect = String(params.get("redirect") || "").trim();
		if (!redirect || /^https?:/i.test(redirect)) return getDashboardUrl();
		if (redirect.startsWith("/")) return redirect;
		return buildAdminUrl(redirect);
	}

	function redirectToLogin() {
		const loginUrl = new URL(getLoginUrl(), global.location.origin);
		loginUrl.searchParams.set("redirect", getSessionRedirectPath());
		global.location.replace(loginUrl.toString());
		return loginUrl.toString();
	}

	// ─── Token storage ───────────────────────────────────────────────────────────

	function getStoredToken() {
		try {
			return String(global.localStorage.getItem(TOKEN_STORAGE_KEY) || "").trim();
		} catch (_) {
			return "";
		}
	}

	function storeToken(token) {
		try {
			if (token) {
				global.localStorage.setItem(TOKEN_STORAGE_KEY, String(token).trim());
			} else {
				global.localStorage.removeItem(TOKEN_STORAGE_KEY);
			}
		} catch (_) {
			// storage not available
		}
	}

	// ─── JWT local validation ────────────────────────────────────────────────────
	// Decodes the payload of a JWT without verifying the signature.
	// Used only to check the expiry claim so page guards work offline.
	// Actual signature verification is enforced by the backend on every API call.

	function decodeJwtPayload(token) {
		try {
			const parts = String(token || "").split(".");
			if (parts.length !== 3) return null;
			// Base64url → Base64
			const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
			const json = decodeURIComponent(
				atob(base64)
					.split("")
					.map(function (c) {
						return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
					})
					.join("")
			);
			return JSON.parse(json);
		} catch (_) {
			return null;
		}
	}

	function isTokenExpired(token) {
		const payload = decodeJwtPayload(token);
		if (!payload || typeof payload.exp !== "number") return true;
		// Add a 10-second clock-skew buffer
		return Date.now() / 1000 > payload.exp - 10;
	}

	function getAdminFromToken(token) {
		const payload = decodeJwtPayload(token);
		if (!payload || payload.role !== "admin" || !payload.email) return null;
		return { email: payload.email };
	}

	// ─── Session API ─────────────────────────────────────────────────────────────

	function getSession() {
		return sessionCache;
	}

	function getToken() {
		return getStoredToken();
	}

	function isLoggedIn() {
		const token = getStoredToken();
		if (!token) return false;
		if (isTokenExpired(token)) {
			storeToken("");
			return false;
		}
		return true;
	}

	async function login(credentials) {
		const adminApiBaseUrl = String(global.AdminConfig?.adminApiBaseUrl || "").replace(/\/+$/, "");
		const response = await global.fetch(`${adminApiBaseUrl}/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(credentials)
		});

		const payload = await response.json().catch(function () { return null; });

		if (!response.ok) {
			throw new Error(payload && payload.message ? payload.message : "Invalid credentials");
		}

		const token = String(payload && payload.data && payload.data.token || "").trim();
		if (!token) throw new Error("Login succeeded but no token was returned.");

		storeToken(token);
		const admin = getAdminFromToken(token) || payload.data.admin || null;
		sessionCache = { token, admin };
		return sessionCache;
	}

	function logout(options) {
		sessionCache = null;
		storeToken("");
		if (options?.redirect !== false) {
			global.location.replace(getLoginUrl());
		}
	}

	// validateSession: verifies the stored token locally (expiry + role claim).
	// Falls back to a backend profile call only when `forceRemote` is true.
	async function validateSession(options) {
		const token = getStoredToken();

		if (!token) {
			sessionCache = null;
			return null;
		}

		if (isTokenExpired(token)) {
			sessionCache = null;
			storeToken("");
			return null;
		}

		const admin = getAdminFromToken(token);
		if (!admin) {
			sessionCache = null;
			storeToken("");
			return null;
		}

		// Token is structurally valid and not expired — trust it for page guards.
		// The backend enforces signature verification on every data API call.
		sessionCache = { token, admin };

		if (options?.forceRemote) {
			try {
				const adminApiBaseUrl = String(global.AdminConfig?.adminApiBaseUrl || "").replace(/\/$/, "");
				const res = await global.fetch(`${adminApiBaseUrl}/profile`, {
					method: "GET",
					headers: { Authorization: `Bearer ${token}` }
				});
				if (!res.ok) {
					sessionCache = null;
					storeToken("");
					return null;
				}
			} catch (_) {
				// Backend unreachable — keep the locally-verified session alive.
				// The token will still be rejected by the backend on data API calls
				// if it has been tampered with.
			}
		}

		return sessionCache;
	}

	// requireAuth: called automatically on every page load.
	async function requireAuth() {
		if (isLoginPage()) {
			// If already logged in, skip the login page and go straight to the
			// destination (or dashboard).
			if (isLoggedIn()) {
				const session = await validateSession();
				if (session) {
					global.location.replace(getPostLoginRedirectUrl());
					return session;
				}
			}
			return null;
		}

		// Not the login page — enforce auth.
		if (!isLoggedIn()) {
			redirectToLogin();
			return null;
		}

		const session = await validateSession();
		if (!session) {
			redirectToLogin();
			return null;
		}

		return session;
	}

	// ─── Public API ──────────────────────────────────────────────────────────────

	global.AdminAuthService = {
		getSession,
		login,
		logout,
		getToken,
		isLoggedIn,
		validateSession,
		requireAuth,
		getLoginUrl,
		getDashboardUrl,
		getPostLoginRedirectUrl,
		redirectToLogin
	};

	requireAuth().catch(function () {
		if (!isLoginPage()) {
			redirectToLogin();
		}
	});
})(window);
