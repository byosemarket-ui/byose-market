// Centralized auth service (browser-friendly, no external deps)
// Implements full local auth using a persistent `bm_users` array,
// current session keys `bm_current_user` and `bm_logged_in`,
// and keeps legacy `bm_user` for backward compatibility.
const authService = (function () {
    const USERS_KEY = 'bm_users';
    const LEGACY_USERS_KEY = 'byose_market_users';
    const CURRENT_USER_KEY = 'bm_current_user';
    const LEGACY_USER_KEY = 'bm_user';
    const STOREFRONT_USER_KEY = 'byose_market_user';
    const LOGGED_KEY = 'bm_logged_in';
    const CUSTOMERS_EVENT = 'byose:customers-changed';

    function _dispatch(name, detail) {
        try {
            window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
        } catch (e) {}
    }

    function _getUsers() {
        try {
            const raw = localStorage.getItem(USERS_KEY) || localStorage.getItem(LEGACY_USERS_KEY);
            return raw ? JSON.parse(raw) || [] : [];
        } catch (e) {
            return [];
        }
    }

    function _saveUsers(users) {
        const serialized = JSON.stringify(users || []);
        try { localStorage.setItem(USERS_KEY, serialized); } catch (e) { console.error(e); }
        try { localStorage.setItem(LEGACY_USERS_KEY, serialized); } catch (e) { console.error(e); }
        _dispatch(CUSTOMERS_EVENT, { action: 'sync-users' });
    }

    function _setCurrent(user) {
        const serialized = JSON.stringify(user || {});
        try { localStorage.setItem(CURRENT_USER_KEY, serialized); } catch (e) { console.error(e); }
        try { localStorage.setItem(LEGACY_USER_KEY, serialized); } catch (e) { console.error(e); }
        try { localStorage.setItem(STOREFRONT_USER_KEY, serialized); } catch (e) { console.error(e); }
        try { localStorage.setItem(LOGGED_KEY, 'true'); } catch (e) { console.error(e); }
        _dispatch('userUpdated', user || null);
    }

    function _clearSession() {
        try { localStorage.removeItem(CURRENT_USER_KEY); } catch (e) {}
        try { localStorage.removeItem(LEGACY_USER_KEY); } catch (e) {}
        try { localStorage.removeItem(STOREFRONT_USER_KEY); } catch (e) {}
        try { localStorage.removeItem(LOGGED_KEY); } catch (e) {}
        _dispatch('userUpdated', null);
    }

    function _findUserIndex(users, user) {
        const email = String(user && user.email || '').trim().toLowerCase();
        const phone = String(user && user.phone || '').trim();
        return users.findIndex((entry) => {
            const entryEmail = String(entry && entry.email || '').trim().toLowerCase();
            const entryPhone = String(entry && entry.phone || '').trim();
            return (email && entryEmail === email)
                || (phone && entryPhone === phone)
                || (user && user.id && String(entry && entry.id || '') === String(user.id));
        });
    }

    function _syncUserRecord(user) {
        if (!user || typeof user !== 'object') {
            return;
        }

        const users = _getUsers();
        const index = _findUserIndex(users, user);

        if (index === -1) {
            users.push(user);
        } else {
            users[index] = {
                ...users[index],
                ...user
            };
        }

        _saveUsers(users);
    }

    function _createLetterAvatar(name) {
        const letter = (name || '?').trim()[0] || '?';
        const hue = (letter.toUpperCase().charCodeAt(0) * 37) % 360;
        const bg = `hsl(${hue} 65% 50%)`;
        const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'><rect width='100%' height='100%' fill='${bg}'/><text x='50%' y='50%' font-family='Poppins, Arial, sans-serif' font-size='120' fill='white' dominant-baseline='middle' text-anchor='middle'>${letter.toUpperCase()}</text></svg>`;
        return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    }

    function _pad(num, size = 5) {
        let s = String(num);
        while (s.length < size) s = '0' + s;
        return s;
    }

    function generateUserId() {
        const users = _getUsers();
        if (!users.length) return 'BM00001';
        // find highest numeric suffix
        const nums = users.map(u => {
            try { return parseInt((u.id || '').replace(/^BM0*/, '') || '0', 10); } catch { return 0; }
        });
        const max = Math.max(...nums, 0);
        return 'BM' + _pad(max + 1);
    }

    function register(user) {
        user = user || {};
        user.name = (user.name || '').trim();
        user.email = user.email ? (user.email || '').toLowerCase().trim() : '';
        user.phone = user.phone ? (user.phone || '').trim() : '';
        user.password = user.password || '';

        // Basic validation
        if (!user.name) return { success: false, error: 'empty_name' };
        if (!user.email && !user.phone) return { success: false, error: 'email_or_phone_required' };
        // use validation service if available
        if (user.email && typeof validation !== 'undefined' && !validation.isValidEmail(user.email)) return { success: false, error: 'invalid_email' };
        if (user.phone && typeof validation !== 'undefined' && !validation.isValidPhone(user.phone)) return { success: false, error: 'invalid_phone' };
        // fallback basic checks when validation is unavailable
        if (user.email && (typeof validation === 'undefined') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) return { success: false, error: 'invalid_email' };
        if (user.phone && (typeof validation === 'undefined')) {
            const cleaned = (user.phone || '').replace(/[^0-9+]/g, '');
            if (cleaned.length < 9 || cleaned.length > 15) return { success: false, error: 'invalid_phone' };
        }
        if (!user.password || String(user.password).length < 4) return { success: false, error: 'weak_password' };

        const users = _getUsers();

        // Duplicates
        if (user.email && users.some(u => u.email && u.email.toLowerCase() === user.email.toLowerCase())) {
            return { success: false, error: 'email_exists' };
        }
        if (user.phone && users.some(u => u.phone && u.phone === user.phone)) {
            return { success: false, error: 'phone_exists' };
        }

        // create user object
        const id = generateUserId();
        const avatar = user.avatar || _createLetterAvatar(user.name || user.email || 'U');
        const createdAt = Date.now();

        const newUser = {
            id,
            name: user.name,
            email: user.email || '',
            phone: user.phone || '',
            password: String(user.password),
            avatar,
                createdAt,
                status: 'active',
                verified: false,
                address: {
                    line1: '',
                    city: '',
                    district: '',
                    sector: '',
                    cell: '',
                    village: ''
                }
        };

        users.push(newUser);
        _saveUsers(users);

        // set session
        _setCurrent(newUser);

        return { success: true, user: newUser };
    }

    function loginByIdentifier(identifier, password) {
        const id = (identifier || '').toString().trim().toLowerCase();
        if (!id) return { success: false, error: 'empty_identifier' };

        const users = _getUsers();
        const user = users.find(u => (u.email && u.email.toLowerCase() === id) || (u.phone && u.phone === id));

        if (!user) return { success: false, error: 'user_not_found' };
	        if (String(user.status || 'active').toLowerCase() === 'blocked') return { success: false, error: 'account_blocked' };
        if (user.password && user.password !== String(password)) return { success: false, error: 'invalid_password' };

        _setCurrent(user);
        return { success: true, user };
    }

    function logout() {
        _clearSession();
    }

    function getCurrentUser() {
        try {
            const raw = localStorage.getItem(CURRENT_USER_KEY) || localStorage.getItem(LEGACY_USER_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function isLoggedIn() {
        return localStorage.getItem(LOGGED_KEY) === 'true';
    }

    // expose functions
    const api = {
        register,
        loginByIdentifier,
        login: loginByIdentifier,
        logout,
        getCurrentUser,
        isLoggedIn,
        generateUserId,
        _internal: { _getUsers, _saveUsers }
    };

    // attach convenient globals for legacy code
    try { window.authService = api; } catch (e) {}
    try { window.createUser = register; window.loginUser = loginByIdentifier; window.logoutUser = logout; window.generateUserId = generateUserId; window.isLoggedIn = isLoggedIn; window.getCurrentUser = getCurrentUser; } catch (e) {}

    return api;
})();
