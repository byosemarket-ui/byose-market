// ===============================
// 💾 STORAGE SYSTEM (PRO)
// ===============================

// KEYS
const STORAGE_KEYS = {
    user: "byose_market_user",
    session: "byose_market_session",
    language: "byose_market_language",
    theme: "byose_market_theme"
};


// ===============================
// 👤 USER
// ===============================
function saveUser(user) {
    // Backwards compatible single-user storage (keeps previous behavior)
    localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
    // also mirror into standardized key
    try { localStorage.setItem('bm_user', JSON.stringify(user)); } catch (e) {}
    try { localStorage.setItem('bm_current_user', JSON.stringify(user)); } catch (e) {}
    // Also ensure user exists in users list
    const users = getUsersList();
    const idx = users.findIndex(u => (u.email && u.email === user.email) || (u.phone && u.phone === user.phone));
    if (idx !== -1) {
        users[idx] = {
            ...users[idx],
            ...user
        };
    } else {
        users.push(user);
    }
    localStorage.setItem("byose_market_users", JSON.stringify(users));
    try { localStorage.setItem('bm_users', JSON.stringify(users)); } catch (e) {}
}

function getUser() {
    try { return JSON.parse(localStorage.getItem('bm_user')) || JSON.parse(localStorage.getItem(STORAGE_KEYS.user)); } catch (e) { return JSON.parse(localStorage.getItem(STORAGE_KEYS.user)); }
}

function removeUser() {
    localStorage.removeItem(STORAGE_KEYS.user);
}

// ===============================
// 👥 USERS LIST (MULTI-USER SUPPORT)
// ===============================
function getUsersList() {
    try {
        // Prefer canonical `bm_users` key when present
        const bm = localStorage.getItem('bm_users');
        if (bm) return JSON.parse(bm) || [];
        return JSON.parse(localStorage.getItem("byose_market_users")) || [];
    } catch (e) {
        return [];
    }
}

function saveUsersList(users) {
    localStorage.setItem("byose_market_users", JSON.stringify(users));
    try { localStorage.setItem('bm_users', JSON.stringify(users || [])); } catch (e) {}
}

function findUserByEmailOrPhone(identifier) {
    if (!identifier) return null;
    const users = getUsersList();
    return users.find(u => (u.email && u.email.toLowerCase() === identifier.toLowerCase()) || (u.phone && u.phone === identifier));
}

function addOrUpdateUser(user) {
    const users = getUsersList();
    const idx = users.findIndex(u => (u.email && user.email && u.email.toLowerCase() === user.email.toLowerCase()) || (u.phone && user.phone && u.phone === user.phone));
    if (idx !== -1) users[idx] = user; else users.push(user);
    saveUsersList(users);
    try { localStorage.setItem('bm_users', JSON.stringify(users)); } catch (e) {}
}


// ===============================
// 🔐 SESSION
// ===============================
function saveSession(user) {
    localStorage.setItem(STORAGE_KEYS.session, JSON.stringify({ loggedIn: true, user: user }));
    try { localStorage.setItem('bm_logged_in', 'true'); } catch (e) {}
    try { localStorage.setItem('bm_user', JSON.stringify(user)); } catch (e) {}
    try { localStorage.setItem('bm_current_user', JSON.stringify(user)); } catch (e) {}
}

function getSession() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.session));
}

function clearSession() {
    localStorage.removeItem(STORAGE_KEYS.session);
    try { localStorage.removeItem('bm_logged_in'); } catch (e) {}
    try { localStorage.removeItem('bm_current_user'); } catch (e) {}
}

function isLoggedIn() {
    const session = getSession();
    return session && session.loggedIn;
}


// ===============================
// 🌐 LANGUAGE
// ===============================
function setLanguageStorage(lang) {
    localStorage.setItem(STORAGE_KEYS.language, lang);
}

function getLanguageStorage() {
    return localStorage.getItem(STORAGE_KEYS.language) || "rw";
}


// ===============================
// 🎨 THEME
// ===============================
function setThemeStorage(theme) {
    localStorage.setItem(STORAGE_KEYS.theme, theme);
}

function getThemeStorage() {
    return localStorage.getItem(STORAGE_KEYS.theme) || "dark";
}


// ===============================
// 🧹 CLEAR ALL (OPTIONAL)
// ===============================
function clearAllStorage() {
    localStorage.clear();
}