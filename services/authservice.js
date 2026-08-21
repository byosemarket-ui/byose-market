const authService = (function () {
    const TOKEN_KEY = 'bm_auth_token';
    const REFRESH_TOKEN_KEY = 'bm_refresh_token';
    const CURRENT_USER_KEY = 'bm_current_user';
    const LEGACY_USER_KEY = 'bm_user';
    const STOREFRONT_USER_KEY = 'byose_market_user';
    const LOGGED_KEY = 'bm_logged_in';
    const SESSION_KEY = 'byose_market_session';
    const REMEMBER_KEY = 'bm_remember_me';
    const USER_EVENT = 'userUpdated';
    const PRODUCTION_API_ORIGIN = 'https://byosemarket.com';
    const LEGACY_API_PATTERN = /(?:onrender\.com|localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i;
    const AUTH_KEYS = [TOKEN_KEY, REFRESH_TOKEN_KEY, CURRENT_USER_KEY, LEGACY_USER_KEY, STOREFRONT_USER_KEY, LOGGED_KEY, SESSION_KEY];
    const AUTH_EPOCH_KEY = 'bm_auth_epoch';
    let refreshInFlight = null;
    let sessionReadyPromise = null;

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
        try {
            if (window.ByoseAuthApiOrigin && typeof window.ByoseAuthApiOrigin.resolveAuthApiOrigin === 'function') {
                return window.ByoseAuthApiOrigin.resolveAuthApiOrigin();
            }
        } catch (error) {}

        const runtimeOverride = normalizeBase(window.BYOSE_API_BASE_URL || window.__BYOSE_API_BASE__ || '');
        if (runtimeOverride && !LEGACY_API_PATTERN.test(runtimeOverride)) {
            return runtimeOverride.replace(/\/api$/i, '');
        }

        const hostname = String(window.location?.hostname || '').trim().toLowerCase();
        const protocol = String(window.location?.protocol || '').toLowerCase();
        const origin = normalizeBase(window.location?.origin || '');
        if (protocol === 'file:' || isLocalHost(hostname)) {
            return `http://${hostname || 'localhost'}:5000`;
        }
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

    function _isTokenExpired(token, skewMs) {
        try {
            const payloadSegment = String(token || '').split('.')[1];
            if (!payloadSegment) {
                return true;
            }

            const base64 = `${payloadSegment.replace(/-/g, '+').replace(/_/g, '/')}${'='.repeat((4 - (payloadSegment.length % 4)) % 4)}`;
            const payload = JSON.parse(atob(base64));
            const skew = Number.isFinite(skewMs) ? skewMs : 0;
            return !Number.isFinite(payload.exp) || (payload.exp * 1000) <= (Date.now() + skew);
        } catch (e) {
            return true;
        }
    }

    function _authErrorCode(error) {
        return String(error?.payload?.code || error?.code || '').trim().toUpperCase();
    }

    function _isDefinitiveAuthFailure(error) {
        const status = Number(error?.status || 0);
        const code = _authErrorCode(error);
        if (code === 'SESSION_REVOKED' || code === 'INVALID_TOKEN' || code === 'ACCOUNT_BLOCKED' || code === 'UNAUTHORIZED') {
            return true;
        }
        return status === 401 && code !== 'TOKEN_EXPIRED';
    }

    function _isTransientAuthFailure(error) {
        const status = Number(error?.status || 0);
        if (!status) return true;
        return status === 408 || status === 429 || status >= 500;
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

    function _migrateLegacyStorage() {
        AUTH_KEYS.forEach((key) => {
            try {
                const sessionValue = sessionStorage.getItem(key);
                if (sessionValue && !localStorage.getItem(key)) {
                    localStorage.setItem(key, sessionValue);
                }
                sessionStorage.removeItem(key);
            } catch (e) {}
        });
    }

    function _persistSession(user, token, options) {
        if (options?.epoch != null && options.epoch !== _readAuthEpoch()) {
            return null;
        }
        _migrateLegacyStorage();
        const remember = options?.remember !== false;
        const normalizedUser = _normalizeUser(user);
        const normalizedToken = String(token || '').trim();
        const refreshToken = String(options?.refreshToken || getRefreshToken() || '').trim();
        if (!normalizedUser || !normalizedToken) {
            _clearSession();
            return null;
        }

        try { localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(normalizedUser)); } catch (e) { console.error(e); }
        try { localStorage.setItem(LEGACY_USER_KEY, JSON.stringify(normalizedUser)); } catch (e) { console.error(e); }
        try { localStorage.setItem(STOREFRONT_USER_KEY, JSON.stringify(normalizedUser)); } catch (e) { console.error(e); }
        try { localStorage.setItem(TOKEN_KEY, normalizedToken); } catch (e) { console.error(e); }
        if (refreshToken) {
            try { localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken); } catch (e) { console.error(e); }
        }
        try { localStorage.setItem(LOGGED_KEY, 'true'); } catch (e) { console.error(e); }
        try {
            localStorage.setItem(SESSION_KEY, JSON.stringify({
                loggedIn: true,
                createdAt: Date.now(),
                remember,
                persistent: true
            }));
        } catch (e) { console.error(e); }
        try { localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0'); } catch (e) {}

        AUTH_KEYS.forEach((key) => {
            try { sessionStorage.removeItem(key); } catch (e) {}
        });

        sessionReadyPromise = Promise.resolve(normalizedUser);
        _dispatch(USER_EVENT, normalizedUser);
        if (options?.mergeGuestCart) {
            void _mergeGuestCartAfterAuth();
        }
        return normalizedUser;
    }

    async function _mergeGuestCartAfterAuth() {
        try {
            const cart = window.ByoseCart;
            const sync = window.ByoseStorefrontSync;
            if (!cart || typeof cart.getItems !== 'function') {
                return;
            }

            const guestItems = cart.getItems();
            if (sync && typeof sync.hydrate === 'function') {
                await sync.hydrate(true);
            }

            if (Array.isArray(guestItems) && guestItems.length && typeof cart.mergeGuestCart === 'function') {
                cart.mergeGuestCart(guestItems);
                if (typeof cart.syncNow === 'function') {
                    await cart.syncNow();
                }
            }
        } catch (error) {
            console.warn('[auth] guest cart merge skipped', error);
        }
    }

    function _readAuthEpoch() {
        try { return String(localStorage.getItem(AUTH_EPOCH_KEY) || ''); } catch (e) { return ''; }
    }

    function _bumpAuthEpoch() {
        const next = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        try { localStorage.setItem(AUTH_EPOCH_KEY, next); } catch (e) {}
        return next;
    }

    function _sessionEndedError() {
        const error = new Error('session_ended');
        error.code = 'SESSION_ENDED';
        return error;
    }

    function _clearSession() {
        _bumpAuthEpoch();
        refreshInFlight = null;
        sessionReadyPromise = Promise.resolve(null);
        [localStorage, sessionStorage].forEach((store) => {
            AUTH_KEYS.forEach((key) => {
                try { store.removeItem(key); } catch (e) {}
            });
        });
        try { localStorage.removeItem(REMEMBER_KEY); } catch (e) {}
        _dispatch(USER_EVENT, null);
    }

    async function _request(path, options) {
        const epoch = _readAuthEpoch();
        const response = await fetch(`${API_BASE}${path}`, {
            method: options?.method || 'GET',
            cache: 'no-store',
            keepalive: Boolean(options?.keepalive),
            headers: {
                ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
                ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
                ...(options?.headers || {}),
                Accept: 'application/json'
            },
            body: options?.body ? JSON.stringify(options.body) : undefined
        });
        if (_readAuthEpoch() !== epoch) {
            throw _sessionEndedError();
        }

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

            const normalizedUser = _persistSession(payload?.user, payload?.token, {
                remember: true,
                refreshToken: payload?.refreshToken,
                mergeGuestCart: true
            });
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

            const normalizedUser = _persistSession(payload?.user, payload?.token, {
                remember,
                refreshToken: payload?.refreshToken,
                mergeGuestCart: true
            });
            return { success: true, user: normalizedUser, token: String(payload?.token || '') };
        } catch (error) {
            diagnostics.logApiFailure('authservice.login', error, { identifier: id });
            return { success: false, error: _mapError(error, 'login_failed') };
        }
    }

    async function logout() {
        const token = getToken();
        const refreshToken = getRefreshToken();
        _clearSession();
        if (!token && !refreshToken) {
            return;
        }
        try {
            await _request('/logout', {
                method: 'POST',
                token,
                body: { refreshToken },
                keepalive: true
            });
        } catch (error) {
            if (_authErrorCode(error) !== 'SESSION_ENDED') {
                diagnostics.logApiFailure('authservice.logout', error);
            }
        }
    }

    function getCurrentUser() {
        _migrateLegacyStorage();
        return _normalizeUser(
            _safeParse(localStorage.getItem(CURRENT_USER_KEY), null)
            || _safeParse(localStorage.getItem(LEGACY_USER_KEY), null)
            || _safeParse(localStorage.getItem(STOREFRONT_USER_KEY), null)
        );
    }

    function getToken() {
        _migrateLegacyStorage();
        return String(localStorage.getItem(TOKEN_KEY) || '').trim();
    }

    function getRefreshToken() {
        _migrateLegacyStorage();
        return String(localStorage.getItem(REFRESH_TOKEN_KEY) || '').trim();
    }

    function hasStoredCredentials() {
        _migrateLegacyStorage();
        return Boolean(getToken() || getRefreshToken());
    }

    function isLoggedIn() {
        _migrateLegacyStorage();
        const user = getCurrentUser();
        const token = getToken();
        const refreshToken = getRefreshToken();
        if (token && !_isTokenExpired(token) && user) {
            return true;
        }
        if (refreshToken) {
            return true;
        }
        return Boolean(token && !_isTokenExpired(token));
    }

    function setCurrentUser(user) {
        const currentToken = getToken();
        const remember = localStorage.getItem(REMEMBER_KEY) !== '0';
        return _persistSession(user, currentToken || '', {
            remember,
            refreshToken: getRefreshToken()
        });
    }

    async function _refreshAccessToken() {
        const refreshToken = getRefreshToken();
        if (!refreshToken) {
            return null;
        }
        if (refreshInFlight) {
            return refreshInFlight;
        }

        refreshInFlight = (async () => {
            const payload = await _request('/refresh', {
                method: 'POST',
                body: { refreshToken }
            });
            const remember = localStorage.getItem(REMEMBER_KEY) !== '0';
            return _persistSession(payload?.user || getCurrentUser(), payload?.token, {
                remember,
                refreshToken: payload?.refreshToken || refreshToken
            });
        })().finally(() => {
            refreshInFlight = null;
        });

        return refreshInFlight;
    }

    async function restoreSession() {
        _migrateLegacyStorage();
        const token = getToken();
        const refreshToken = getRefreshToken();
        const user = getCurrentUser();
        const remember = localStorage.getItem(REMEMBER_KEY) !== '0';

        if (token && !_isTokenExpired(token, 60 * 1000)) {
            if (user) {
                return user;
            }
            try {
                const payload = await _request('/me', { method: 'GET', token });
                return _persistSession(payload?.user, token, { remember, refreshToken });
            } catch (error) {
                if (_authErrorCode(error) === 'SESSION_ENDED') {
                    return null;
                }
                if (_authErrorCode(error) !== 'TOKEN_EXPIRED' || !refreshToken) {
                    if (_isDefinitiveAuthFailure(error)) {
                        _clearSession();
                        return null;
                    }
                    return user || null;
                }
            }
        }

        if (refreshToken) {
            try {
                return await _refreshAccessToken();
            } catch (error) {
                if (_authErrorCode(error) === 'SESSION_ENDED') {
                    return null;
                }
                if (_isDefinitiveAuthFailure(error)) {
                    _clearSession();
                    return null;
                }
                return user || null;
            }
        }

        if (token && _isTokenExpired(token) && !refreshToken) {
            _clearSession();
        }

        return null;
    }

    async function refreshCurrentUser() {
        const restored = await restoreSession();
        const token = getToken();
        if (!token && !getRefreshToken()) {
            return restored || null;
        }

        try {
            let accessToken = getToken();
            if (!accessToken || _isTokenExpired(accessToken, 15 * 1000)) {
                const refreshedUser = await _refreshAccessToken().catch((error) => {
                    if (_isDefinitiveAuthFailure(error)) {
                        throw error;
                    }
                    return null;
                });
                accessToken = getToken();
                if (!accessToken) {
                    return refreshedUser || getCurrentUser();
                }
            }

            const payload = await _request('/me', { method: 'GET', token: accessToken });
            const remember = localStorage.getItem(REMEMBER_KEY) !== '0';
            return _persistSession(payload?.user, accessToken, {
                remember,
                refreshToken: getRefreshToken()
            });
        } catch (error) {
            if (_authErrorCode(error) === 'SESSION_ENDED') {
                return null;
            }
            if (_authErrorCode(error) === 'TOKEN_EXPIRED') {
                try {
                    return await _refreshAccessToken();
                } catch (refreshError) {
                    if (_authErrorCode(refreshError) === 'SESSION_ENDED') {
                        return null;
                    }
                    if (_isDefinitiveAuthFailure(refreshError)) {
                        _clearSession();
                        return null;
                    }
                    return getCurrentUser();
                }
            }
            if (_isDefinitiveAuthFailure(error)) {
                _clearSession();
                return null;
            }
            diagnostics.logApiFailure('authservice.refreshCurrentUser', error);
            return getCurrentUser();
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

        const normalizedUser = _persistSession(payload?.user, payload?.token || token, {
            remember: localStorage.getItem(REMEMBER_KEY) !== '0',
            refreshToken: payload?.refreshToken || getRefreshToken()
        });
        return normalizedUser;
    }

    async function changePassword(currentPassword, newPassword) {
        const token = getToken();
        if (!token) {
            throw new Error('not_authenticated');
        }

        const payload = await _request('/change-password', {
            method: 'POST',
            token,
            body: { currentPassword, newPassword }
        });

        if (payload?.token) {
            _persistSession(getCurrentUser(), payload.token, {
                remember: localStorage.getItem(REMEMBER_KEY) !== '0',
                refreshToken: payload.refreshToken || getRefreshToken()
            });
        }

        return payload;
    }

    async function authFetch(url, options) {
        await restoreSession().catch(() => {});
        const send = () => {
            const token = getToken();
            return fetch(url, {
                ...(options || {}),
                headers: {
                    ...((options && options.headers) || {}),
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                }
            });
        };

        let response = await send();
        if (response.status === 401 && getRefreshToken()) {
            try {
                await _refreshAccessToken();
                response = await send();
            } catch (error) {
                if (_isDefinitiveAuthFailure(error)) {
                    _clearSession();
                }
            }
        }
        return response;
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
        getRefreshToken,
        hasStoredCredentials,
        setCurrentUser,
        restoreSession,
        whenReady,
        refreshCurrentUser,
        updateProfile,
        changePassword,
        authFetch,
        openAccount
    };

    try { window.authService = api; } catch (e) {}
    try { window.createUser = register; window.loginUser = loginByIdentifier; window.logoutUser = logout; window.isLoggedIn = isLoggedIn; window.getCurrentUser = getCurrentUser; window.setCurrentUser = setCurrentUser; window.handleAccountClick = openAccount; } catch (e) {}

    function whenReady() {
        if (!sessionReadyPromise) {
            sessionReadyPromise = restoreSession().catch(() => getCurrentUser());
        }
        return sessionReadyPromise;
    }

    try {
        window.addEventListener('storage', (event) => {
            const key = String(event?.key || '');
            if (key && !AUTH_KEYS.includes(key) && key !== REMEMBER_KEY && key !== AUTH_EPOCH_KEY) {
                return;
            }
            _migrateLegacyStorage();
            _dispatch(USER_EVENT, isLoggedIn() ? getCurrentUser() : null);
        });
    } catch (e) {}

    whenReady();

    if (typeof document !== 'undefined') {
        const boot = () => {
            whenReady().then((user) => {
                if (user || isLoggedIn()) {
                    refreshCurrentUser().catch(() => {});
                }
            }).catch(() => {});
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', boot);
        } else {
            boot();
        }
    }

    return api;
})();
