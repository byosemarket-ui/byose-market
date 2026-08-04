const authService = (function () {
    const TOKEN_KEY = 'bm_auth_token';
    const CURRENT_USER_KEY = 'bm_current_user';
    const LEGACY_USER_KEY = 'bm_user';
    const STOREFRONT_USER_KEY = 'byose_market_user';
    const LOGGED_KEY = 'bm_logged_in';
    const SESSION_KEY = 'byose_market_session';
    const REMEMBER_KEY = 'bm_remember_me';
    const USER_EVENT = 'userUpdated';
    const PRODUCTION_API_ORIGIN = 'https://byosemarket.com';
    const LEGACY_API_PATTERN = /(?:onrender\.com|localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i;

    function normalizeBase(value) {
        return String(value || '').trim().replace(/\/+$/, '');
    }

    function isLocalHost(hostname) {
        return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
    }

    function shouldUseProductionApi(hostname) {
        return /(^|\.)(github\.io|byosemarket\.com)$/i.test(String(hostname || ''));
    }

    function resolveApiOrigin() {
        const runtimeOverride = normalizeBase(window.BYOSE_API_BASE_URL || window.__BYOSE_API_BASE__ || '');
        if (runtimeOverride && !LEGACY_API_PATTERN.test(runtimeOverride)) {
            return runtimeOverride.replace(/\/api$/i, '');
        }

        const hostname = String(window.location?.hostname || '').trim().toLowerCase();
        const origin = normalizeBase(window.location?.origin || '');
        if (origin && /byosemarket\.com$/i.test(hostname)) {
            return origin;
        }

        return PRODUCTION_API_ORIGIN;
    }

    const API_BASE = `${resolveApiOrigin()}/api/auth`;

    try {
        if (!window.__BYOSE_API_BASE__) {
            window.__BYOSE_API_BASE__ = resolveApiOrigin();
        }
    } catch (error) {}

    function ensureDiagnostics() {
        if (window.ByoseDiagnostics) {
            return window.ByoseDiagnostics;
        }

        const entries = [];
        const MAX_ENTRIES = 200;

        function push(level, event, detail) {
            const entry = {
                timestamp: new Date().toISOString(),
                level,
                event,
                detail: detail || {}
            };

            entries.push(entry);
            if (entries.length > MAX_ENTRIES) {
                entries.shift();
            }

            if (window.console && typeof window.console[level] === 'function') {
                window.console[level](`[ByoseDiagnostics] ${event}`, detail || {});
            }

            return entry;
        }

        window.ByoseDiagnostics = {
            logInfo(event, detail) { return push('info', event, detail); },
            logWarn(event, detail) { return push('warn', event, detail); },
            logError(event, detail) { return push('error', event, detail); },
            logApiFailure(scope, error, detail) {
                return push('warn', 'api.failure', {
                    scope,
                    message: String(error?.message || ''),
                    status: Number(error?.status || 0) || undefined,
                    ...(detail || {})
                });
            },
            logSyncIssue(scope, detail) { return push('warn', 'sync.issue', { scope, ...(detail || {}) }); },
            getEntries() { return entries.slice(); }
        };

        return window.ByoseDiagnostics;
    }

    const diagnostics = ensureDiagnostics();

    function _dispatch(name, detail) {
        try {
            window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
        } catch (e) {}
    }

    function _safeParse(value, fallbackValue) {
        try {
            return value ? JSON.parse(value) : fallbackValue;
        } catch (e) {
            return fallbackValue;
        }
    }

    function _isTokenExpired(token) {
        try {
            const payloadSegment = String(token || '').split('.')[1];
            if (!payloadSegment) {
                return true;
            }

            const base64 = `${payloadSegment.replace(/-/g, '+').replace(/_/g, '/')}${'='.repeat((4 - (payloadSegment.length % 4)) % 4)}`;
            const payload = JSON.parse(atob(base64));
            return !Number.isFinite(payload.exp) || (payload.exp * 1000) <= Date.now();
        } catch (e) {
            return true;
        }
    }

    function _normalizeUser(user) {
        if (!user || typeof user !== 'object') {
            return null;
        }

        return {
            ...user,
            id: String(user.id || user.userId || '').trim(),
            name: String(user.name || '').trim(),
            email: String(user.email || '').trim().toLowerCase(),
            phone: String(user.phone || '').trim(),
            avatar: String(user.avatar || '').trim(),
            status: String(user.status || 'active').trim().toLowerCase() === 'blocked' ? 'blocked' : 'active',
            verified: Boolean(user.verified),
            address: user.address && typeof user.address === 'object' ? user.address : {}
        };
    }

    function _getActiveStorage() {
        try {
            if (sessionStorage.getItem(TOKEN_KEY)) {
                return sessionStorage;
            }
        } catch (e) {}

        return localStorage;
    }

    function _persistSession(user, token, options) {
        const remember = options?.remember !== false;
        const normalizedUser = _normalizeUser(user);
        const normalizedToken = String(token || '').trim();
        if (!normalizedUser || !normalizedToken) {
            _clearSession();
            return null;
        }

        const primary = remember ? localStorage : sessionStorage;
        const secondary = remember ? sessionStorage : localStorage;

        [TOKEN_KEY, CURRENT_USER_KEY, LEGACY_USER_KEY, STOREFRONT_USER_KEY, LOGGED_KEY, SESSION_KEY].forEach((key) => {
            try { secondary.removeItem(key); } catch (e) {}
        });

        try { primary.setItem(CURRENT_USER_KEY, JSON.stringify(normalizedUser)); } catch (e) { console.error(e); }
        try { primary.setItem(LEGACY_USER_KEY, JSON.stringify(normalizedUser)); } catch (e) { console.error(e); }
        try { primary.setItem(STOREFRONT_USER_KEY, JSON.stringify(normalizedUser)); } catch (e) { console.error(e); }
        try { primary.setItem(TOKEN_KEY, normalizedToken); } catch (e) { console.error(e); }
        try { primary.setItem(LOGGED_KEY, 'true'); } catch (e) { console.error(e); }
        try {
            primary.setItem(SESSION_KEY, JSON.stringify({ loggedIn: true, createdAt: Date.now(), token: normalizedToken, remember }));
        } catch (e) { console.error(e); }
        try { localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0'); } catch (e) {}

        _dispatch(USER_EVENT, normalizedUser);
        return normalizedUser;
    }

    function _clearSession() {
        [localStorage, sessionStorage].forEach((store) => {
            try { store.removeItem(CURRENT_USER_KEY); } catch (e) {}
            try { store.removeItem(LEGACY_USER_KEY); } catch (e) {}
            try { store.removeItem(STOREFRONT_USER_KEY); } catch (e) {}
            try { store.removeItem(TOKEN_KEY); } catch (e) {}
            try { store.removeItem(SESSION_KEY); } catch (e) {}
            try { store.removeItem(LOGGED_KEY); } catch (e) {}
        });
        try { localStorage.removeItem(REMEMBER_KEY); } catch (e) {}
        _dispatch(USER_EVENT, null);
    }

    async function _request(path, options) {
        const response = await fetch(`${API_BASE}${path}`, {
            method: options?.method || 'GET',
            headers: {
                ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
                ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
                ...(options?.headers || {}),
                Accept: 'application/json'
            },
            body: options?.body ? JSON.stringify(options.body) : undefined
        });

        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        const payload = contentType.includes('application/json')
            ? await response.json().catch(() => null)
            : await response.text().catch(() => null);
        if (!response.ok) {
            const message = typeof payload === 'string'
                ? payload.trim()
                : String(payload?.message || '').trim();
            const error = new Error(message || 'Request failed');
            error.status = response.status;
            error.payload = payload;
            diagnostics.logApiFailure('authservice.request', error, { path });
            throw error;
        }

        return payload;
    }

    function _mapError(error, fallback) {
        const message = String(error?.payload?.message || error?.message || '').trim().toLowerCase();
        if (message.includes('email is already registered') || message.includes('email exists')) return 'email_exists';
        if (message.includes('phone number is already registered') || message.includes('phone exists')) return 'phone_exists';
        if (message.includes('password must be 8') || message.includes('password too weak')) return 'weak_password';
        if (message.includes('account not found')) return 'user_not_found';
        if (message.includes('incorrect password')) return 'invalid_password';
        if (message.includes('account blocked')) return 'account_blocked';
        if (message.includes('too many failed login')) return 'account_locked';
        if (message.includes('email or phone required')) return 'email_or_phone_required';
        if (message.includes('name required')) return 'empty_name';
        return fallback || 'request_failed';
    }

    function isStrongPassword(password) {
        const value = String(password || '');
        return value.length >= 8
            && value.length <= 128
            && /[a-z]/.test(value)
            && /[A-Z]/.test(value)
            && /\d/.test(value);
    }

    async function register(user) {
        user = user || {};
        user.name = (user.name || '').trim();
        user.email = user.email ? (user.email || '').toLowerCase().trim() : '';
        user.phone = user.phone ? (user.phone || '').trim() : '';
        user.password = user.password || '';

        if (!user.name) return { success: false, error: 'empty_name' };
        if (!user.email && !user.phone) return { success: false, error: 'email_or_phone_required' };
        if (user.email && typeof validation !== 'undefined' && !validation.isValidEmail(user.email)) return { success: false, error: 'invalid_email' };
        if (user.phone && typeof validation !== 'undefined' && !validation.isValidPhone(user.phone)) return { success: false, error: 'invalid_phone' };
        if (user.email && (typeof validation === 'undefined') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) return { success: false, error: 'invalid_email' };
        if (user.phone && (typeof validation === 'undefined')) {
            const cleaned = (user.phone || '').replace(/[^0-9+]/g, '');
            if (cleaned.length < 9 || cleaned.length > 15) return { success: false, error: 'invalid_phone' };
        }
        if (!isStrongPassword(user.password)) return { success: false, error: 'weak_password' };

        try {
            const payload = await _request('/signup', {
                method: 'POST',
                body: {
                    name: user.name,
                    email: user.email || '',
                    phone: user.phone || '',
                    password: user.password,
                    avatar: user.avatar || ''
                }
            });

            const normalizedUser = _persistSession(payload?.user, payload?.token, { remember: true });
            return { success: true, user: normalizedUser, token: String(payload?.token || '') };
        } catch (error) {
            diagnostics.logApiFailure('authservice.register', error, { identifier: user.email || user.phone || '' });
            return { success: false, error: _mapError(error, 'signup_failed') };
        }
    }

    async function loginByIdentifier(identifier, password, options) {
        const id = (identifier || '').toString().trim().toLowerCase();
        if (!id) return { success: false, error: 'empty_identifier' };
        const remember = options?.remember !== false;

        try {
            const payload = await _request('/login', {
                method: 'POST',
                body: {
                    identifier: id,
                    password: String(password || ''),
                    rememberMe: remember
                }
            });

            const normalizedUser = _persistSession(payload?.user, payload?.token, { remember });
            return { success: true, user: normalizedUser, token: String(payload?.token || '') };
        } catch (error) {
            diagnostics.logApiFailure('authservice.login', error, { identifier: id });
            return { success: false, error: _mapError(error, 'login_failed') };
        }
    }

    function logout() {
        _clearSession();
    }

    function getCurrentUser() {
        const store = _getActiveStorage();
        return _normalizeUser(
            _safeParse(store.getItem(CURRENT_USER_KEY), null)
            || _safeParse(localStorage.getItem(CURRENT_USER_KEY), null)
            || _safeParse(localStorage.getItem(LEGACY_USER_KEY), null)
            || _safeParse(localStorage.getItem(STOREFRONT_USER_KEY), null)
        );
    }

    function getToken() {
        const store = _getActiveStorage();
        return String(store.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || '').trim();
    }

    function isLoggedIn() {
        const store = _getActiveStorage();
        const token = getToken();
        if (!token || _isTokenExpired(token)) {
            if (token) {
                _clearSession();
            }
            return false;
        }

        return Boolean(getCurrentUser()) && store.getItem(LOGGED_KEY) === 'true';
    }

    function setCurrentUser(user) {
        const currentToken = getToken();
        const remember = localStorage.getItem(REMEMBER_KEY) !== '0';
        return _persistSession(user, currentToken || '', { remember });
    }

    async function refreshCurrentUser() {
        const token = getToken();
        if (!token) {
            _clearSession();
            return null;
        }

        try {
            const payload = await _request('/me', { method: 'GET', token });
            const remember = localStorage.getItem(REMEMBER_KEY) !== '0';
            return _persistSession(payload?.user, token, { remember });
        } catch (error) {
            _clearSession();
            return null;
        }
    }

    async function updateProfile(data) {
        const token = getToken();
        if (!token) {
            throw new Error('not_authenticated');
        }

        const payload = await _request('/me', {
            method: 'PUT',
            token,
            body: data || {}
        });

        const normalizedUser = _persistSession(payload?.user, token, { remember: localStorage.getItem(REMEMBER_KEY) !== '0' });
        return normalizedUser;
    }

    async function changePassword(currentPassword, newPassword) {
        const token = getToken();
        if (!token) {
            throw new Error('not_authenticated');
        }

        return _request('/change-password', {
            method: 'POST',
            token,
            body: { currentPassword, newPassword }
        });
    }

    function authFetch(url, options) {
        const token = getToken();
        return fetch(url, {
            ...(options || {}),
            headers: {
                ...((options && options.headers) || {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            }
        });
    }

    function resolveSitePath(target) {
        const pathname = String(window.location?.pathname || '');
        if (pathname.includes('/account/settings/')) return `../../${target}`;
        if (pathname.includes('/account/') || pathname.includes('/logout/') || pathname.includes('/components/') || pathname.includes('/details/') || pathname.includes('/shop/') || pathname.includes('/auth/')) return `../${target}`;
        return target;
    }

    function openAccount() {
        window.location.assign(resolveSitePath(isLoggedIn() ? 'account/account.html' : 'login.html'));
    }

    const api = {
        register,
        loginByIdentifier,
        login: loginByIdentifier,
        logout,
        getCurrentUser,
        isLoggedIn,
        getToken,
        setCurrentUser,
        refreshCurrentUser,
        updateProfile,
        changePassword,
        authFetch,
        openAccount
    };

    try { window.authService = api; } catch (e) {}
    try { window.createUser = register; window.loginUser = loginByIdentifier; window.logoutUser = logout; window.isLoggedIn = isLoggedIn; window.getCurrentUser = getCurrentUser; window.setCurrentUser = setCurrentUser; window.handleAccountClick = openAccount; } catch (e) {}

    if (typeof document !== 'undefined') {
        document.addEventListener('DOMContentLoaded', () => {
            if (isLoggedIn()) {
                refreshCurrentUser().catch(() => {});
            }
        });
    }

    return api;
})();
