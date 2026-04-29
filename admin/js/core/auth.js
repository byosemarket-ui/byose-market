(function (global) {
	"use strict";

	const STORAGE_KEY = "byose_admin_session_v1";
	const LOGIN_FLAG_KEY = "isAdminLoggedIn";
	const ADMIN_EMAIL = "byosemarket@gmail.com";
	const ADMIN_PASSWORD = "byosemarket266";
	const ADMIN_NAME = "Byose Market Admin";
	const SESSION_TOKEN = "frontend-admin-authenticated";

	function safeParse(value) {
		try {
			return JSON.parse(value);
		} catch (error) {
			return null;
		}
	}

	function getAdminBasePath() {
		const path = String(global.location?.pathname || "").replace(/\\/g, "/");
		const marker = "/admin/";
		const markerIndex = path.toLowerCase().indexOf(marker);

		if (markerIndex !== -1) {
			return path.slice(0, markerIndex + marker.length);
		}

		return "/admin/";
	}

	function buildAdminUrl(relativePath) {
		const cleanPath = String(relativePath || "").replace(/^\/+/, "");
		return `${getAdminBasePath()}${cleanPath}`;
	}

	function getApiBaseUrl() {
		return String(global.AdminConfig?.apiBaseUrl || "/api").replace(/\/$/, "");
	}

	function getAdminApiBaseUrl() {
		return String(global.AdminConfig?.adminApiBaseUrl || `${getApiBaseUrl()}/admin`).replace(/\/$/, "");
	}

	function getSessionRedirectPath() {
		const path = String(global.location?.pathname || "").replace(/\\/g, "/");
		const marker = "/admin/";
		const markerIndex = path.toLowerCase().indexOf(marker);
		const adminPath = markerIndex === -1 ? "dashboard.html" : path.slice(markerIndex + marker.length);
		const suffix = `${global.location?.search || ""}${global.location?.hash || ""}`;
		return `${adminPath || "dashboard.html"}${suffix}`;
	}

	function getLoginUrl() {
		return buildAdminUrl("login.html");
	}

	function getDashboardUrl() {
		return buildAdminUrl("dashboard.html");
	}

	function isLoginPage() {
		return /\/admin\/login\.html$/i.test(String(global.location?.pathname || "").replace(/\\/g, "/"));
	}

	function normalizeSession(value) {
		if (!value || typeof value !== "object") {
			return null;
		}

		const email = String(value.email || value.admin?.email || "").trim().toLowerCase();
		const loggedIn = value.loggedIn === true || String(value.isAdminLoggedIn || "").toLowerCase() === "true";
		if (!loggedIn || email !== ADMIN_EMAIL) {
			return null;
		}

		const admin = value.admin && typeof value.admin === "object" ? value.admin : null;
		const name = String(value.name || admin?.name || ADMIN_NAME).trim() || ADMIN_NAME;

		return {
			token: String(value.token || SESSION_TOKEN).trim() || SESSION_TOKEN,
			admin: {
				name,
				email: ADMIN_EMAIL,
				...(admin || {})
			},
			email,
			name,
			loggedIn: true,
			loggedInAt: value.loggedInAt || new Date().toISOString()
		};
	}

	function getSession() {
		return normalizeSession(safeParse(global.localStorage.getItem(STORAGE_KEY)));
	}

	function persistSession(payload) {
		const session = normalizeSession(payload);
		if (!session) {
			logout({ redirect: false });
			return null;
		}

		global.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
		global.localStorage.setItem(LOGIN_FLAG_KEY, "true");
		return session;
	}

	async function login(credentials) {
		const email = String(credentials?.email || "").trim().toLowerCase();
		const password = String(credentials?.password || "");

		if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
			throw new Error("Invalid admin credentials");
		}

		const session = persistSession({
			token: SESSION_TOKEN,
			admin: {
				name: ADMIN_NAME,
				email: ADMIN_EMAIL
			},
			name: ADMIN_NAME,
			email: ADMIN_EMAIL,
			isAdminLoggedIn: true,
			loggedIn: true,
			loggedInAt: new Date().toISOString()
		});

		if (!session) {
			throw new Error("Invalid admin credentials");
		}

		return session;
	}

	function logout(options) {
		global.localStorage.removeItem(STORAGE_KEY);
		global.localStorage.removeItem(LOGIN_FLAG_KEY);
		if (options?.redirect !== false && !isLoginPage()) {
			global.location.replace(getLoginUrl());
		}
	}

	function getToken() {
		return String(getSession()?.token || "").trim();
	}

	function isLoggedIn() {
		return Boolean(getSession()) && global.localStorage.getItem(LOGIN_FLAG_KEY) === "true";
	}

	function getPostLoginRedirectUrl() {
		const params = new URLSearchParams(global.location?.search || "");
		const redirect = String(params.get("redirect") || "").trim();
		if (!redirect || /^https?:/i.test(redirect)) {
			return getDashboardUrl();
		}

		if (redirect.startsWith("/")) {
			return redirect;
		}

		return buildAdminUrl(redirect);
	}

	function redirectToLogin() {
		const loginUrl = new URL(getLoginUrl(), global.location.origin);
		loginUrl.searchParams.set("redirect", getSessionRedirectPath());
		global.location.replace(loginUrl.toString());
	}

	async function validateSession(options) {
		if (options && options.force) {
			return getSession();
		}

		const session = getSession();
		if (!session || global.localStorage.getItem(LOGIN_FLAG_KEY) !== "true") {
			logout({ redirect: false });
			return null;
		}

		return persistSession(session);
	}

	async function requireAuth() {
		if (isLoginPage()) {
			return getSession();
		}

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

	if (!isLoginPage()) {
		requireAuth();
	}
})(window);
