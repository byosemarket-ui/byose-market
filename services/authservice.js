const authService = (function () {
    const TOKEN_KEY = 'bm_auth_token';
    const CURRENT_USER_KEY = 'bm_current_user';
    const LEGACY_USER_KEY = 'bm_user';
    const STOREFRONT_USER_KEY = 'byose_market_user';
    const LOGGED_KEY = 'bm_logged_in';
    const SESSION_KEY = 'byose_market_session';
    const USER_EVENT = 'userUpdated';
    const API_BASE = '/api/auth';

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

    function _persistSession(user, token) {
        const normalizedUser = _normalizeUser(user);
        const normalizedToken = String(token || '').trim();
        if (!normalizedUser || !normalizedToken) {
            _clearSession();
            return null;
        }

        const serialized = JSON.stringify(user || {});
        try { localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(normalizedUser)); } catch (e) { console.error(e); }
        try { localStorage.setItem(LEGACY_USER_KEY, JSON.stringify(normalizedUser)); } catch (e) { console.error(e); }
        try { localStorage.setItem(STOREFRONT_USER_KEY, JSON.stringify(normalizedUser)); } catch (e) { console.error(e); }
        try { localStorage.setItem(TOKEN_KEY, normalizedToken); } catch (e) { console.error(e); }
        try { localStorage.setItem(LOGGED_KEY, 'true'); } catch (e) { console.error(e); }
        try { localStorage.setItem(SESSION_KEY, JSON.stringify({ loggedIn: true, createdAt: Date.now(), token: normalizedToken })); } catch (e) { console.error(e); }
        _dispatch(USER_EVENT, normalizedUser);
        return normalizedUser;
    }

    function _clearSession() {
        try { localStorage.removeItem(CURRENT_USER_KEY); } catch (e) {}
        try { localStorage.removeItem(LEGACY_USER_KEY); } catch (e) {}
        try { localStorage.removeItem(STOREFRONT_USER_KEY); } catch (e) {}
        try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
        try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
        try { localStorage.removeItem(LOGGED_KEY); } catch (e) {}
        _dispatch(USER_EVENT, null);
    }

    async function _request(path, options) {
        const response = await fetch(`${API_BASE}${path}`, {
            method: options?.method || 'GET',
            headers: {
                ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
                ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
                ...(options?.headers || {})
            },
            body: options?.body ? JSON.stringify(options.body) : undefined
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
            const message = String(payload?.message || '').trim();
            const error = new Error(message || 'Request failed');
            error.status = response.status;
            error.payload = payload;
            throw error;
        }

        return payload;
    }

    function _mapError(error, fallback) {
        const message = String(error?.payload?.message || error?.message || '').trim().toLowerCase();
        if (message.includes('email exists')) return 'email_exists';
        if (message.includes('phone exists')) return 'phone_exists';
        if (message.includes('password too weak')) return 'weak_password';
        if (message.includes('user not found')) return 'user_not_found';
        if (message.includes('invalid credentials')) return 'invalid_password';
        if (message.includes('account blocked')) return 'account_blocked';
        if (message.includes('email or phone required')) return 'email_or_phone_required';
        if (message.includes('name required')) return 'empty_name';
        return fallback || 'request_failed';
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
        if (!user.password || String(user.password).length < 4) return { success: false, error: 'weak_password' };

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

            const normalizedUser = _persistSession(payload?.user, payload?.token);
            return { success: true, user: normalizedUser, token: String(payload?.token || '') };
        } catch (error) {
            return { success: false, error: _mapError(error, 'signup_failed') };
        }
    }

    async function loginByIdentifier(identifier, password) {
        const id = (identifier || '').toString().trim().toLowerCase();
        if (!id) return { success: false, error: 'empty_identifier' };

        try {
            const payload = await _request('/login', {
                method: 'POST',
                body: {
                    identifier: id,
                    password: String(password || '')
                }
            });

            const normalizedUser = _persistSession(payload?.user, payload?.token);
            return { success: true, user: normalizedUser, token: String(payload?.token || '') };
        } catch (error) {
            return { success: false, error: _mapError(error, 'login_failed') };
        }
    }

    function logout() {
        _clearSession();
    }

    function getCurrentUser() {
        return _normalizeUser(
            _safeParse(localStorage.getItem(CURRENT_USER_KEY), null)
            || _safeParse(localStorage.getItem(LEGACY_USER_KEY), null)
            || _safeParse(localStorage.getItem(STOREFRONT_USER_KEY), null)
        );
    }

    function getToken() {
        return String(localStorage.getItem(TOKEN_KEY) || '').trim();
    }

    function isLoggedIn() {
        return Boolean(getToken()) && Boolean(getCurrentUser()) && localStorage.getItem(LOGGED_KEY) === 'true';
    }

    function setCurrentUser(user) {
        const currentToken = getToken();
        return _persistSession(user, currentToken || '');
    }

    async function refreshCurrentUser() {
        const token = getToken();
        if (!token) {
            _clearSession();
            return null;
        }

        try {
            const payload = await _request('/me', { method: 'GET', token });
            return _persistSession(payload?.user, token);
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

        const normalizedUser = _persistSession(payload?.user, token);
        return normalizedUser;
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
        authFetch
    };

    try { window.authService = api; } catch (e) {}
    try { window.createUser = register; window.loginUser = loginByIdentifier; window.logoutUser = logout; window.isLoggedIn = isLoggedIn; window.getCurrentUser = getCurrentUser; window.setCurrentUser = setCurrentUser; } catch (e) {}

    return api;
})();
