// ===============================
// 💾 STORAGE SYSTEM (GLOBAL)
// ===============================

// ===============================
// 🔑 KEYS
// ===============================
const STORAGE_KEYS = {
  USER: "bm_user",
  THEME: "bm_theme",
  LANG: "bm_lang"
};

function getSitePrefix() {
  const path = window.location.pathname || "";
  if (path.includes("/account/settings/")) return "../../";
  if (path.includes("/account/") || path.includes("/logout/") || path.includes("/components/") || path.includes("/details/")) return "../";
  return "";
}

function resolveSitePath(target) {
  return getSitePrefix() + String(target || "").replace(/^\/+/, "");
}

// ===============================
// 💾 SAVE DATA
// ===============================
function saveData(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error("Save Error:", error);
  }
}

// ===============================
// 📥 GET DATA
// ===============================
function getData(key) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error("Get Error:", error);
    return null;
  }
}

// ===============================
// ❌ REMOVE DATA
// ===============================
function removeData(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error("Remove Error:", error);
  }
}

// ===============================
// 🧹 CLEAR ALL
// ===============================
function clearAll() {
  localStorage.clear();
}

// ===============================
// 👤 USER HELPERS
// ===============================
function saveUser(user) {
  saveData(STORAGE_KEYS.USER, user);
}

function getUser() {
  return getData(STORAGE_KEYS.USER);
}

function removeUser() {
  removeData(STORAGE_KEYS.USER);
}

// ===============================
// 🎨 THEME HELPERS
// ===============================
function saveTheme(theme) {
  saveData(STORAGE_KEYS.THEME, theme);
}

function getTheme() {
  return getData(STORAGE_KEYS.THEME);
}

// ===============================
// 🌍 LANGUAGE HELPERS
// ===============================
function saveLanguage(lang) {
  saveData(STORAGE_KEYS.LANG, lang);
}

function getLanguage() {
  return getData(STORAGE_KEYS.LANG);
}

// ===============================
// 🔐 LOGOUT SYSTEM
// ===============================
function logoutUser() {
  // Legacy helper: clear local user record but do not perform navigation.
  removeUser();
  clearSession();
}

// ===============================
// 🔐 SESSION HELPERS
// ===============================
STORAGE_KEYS.SESSION = "bm_session";

function saveSession(session) {
  saveData(STORAGE_KEYS.SESSION, session);
}

function getSession() {
  return getData(STORAGE_KEYS.SESSION);
}

function clearSession() {
  removeData(STORAGE_KEYS.SESSION);
  try { localStorage.removeItem('bm_logged_in'); } catch (e) {}
}

// ===============================
// ⏱ SESSION VALIDATION
// ===============================
function isSessionValid() {
  const s = getSession();
  if (!s) return false;
  // if explicit expiresAt provided, respect it
  if (s.expiresAt) return Date.now() < s.expiresAt;
  // default: consider session valid for 30 days
  if (s.createdAt) return (Date.now() - s.createdAt) < (1000 * 60 * 60 * 24 * 30);
  return true;
}

// ===============================
// 👥 AUTH HELPERS (public API)
// ===============================
function isLoggedIn() {
  if (window.authService && typeof window.authService.isLoggedIn === 'function') {
    try {
      return window.authService.isLoggedIn();
    } catch (e) {}
  }

  const user = getUser();
  const token = (() => {
    try {
      return localStorage.getItem('bm_auth_token')
        || localStorage.getItem('bm_refresh_token')
        || sessionStorage.getItem('bm_auth_token')
        || sessionStorage.getItem('bm_refresh_token')
        || '';
    } catch (e) {
      return '';
    }
  })();

  if (!token || !user) {
    return false;
  }

  return true;
}

function loginUser(userData) {
  if (window.authService && typeof window.authService.setCurrentUser === 'function') {
    return window.authService.setCurrentUser(userData);
  }
  if (!userData) return null;
  saveUser(userData);
  try { localStorage.setItem('bm_logged_in', 'true'); } catch (e) {}
  const session = { loggedIn: true, createdAt: Date.now(), persistent: true };
  saveSession(session);
  return session;
}

function logoutUserFull() {
  if (window.authService && typeof window.authService.logout === 'function') {
    return window.authService.logout();
  }
  removeUser();
  clearSession();
}

function redirectIfNotAuth(options) {
  options = options || {};
  const allow = options.allow || [];
  const path = window.location.pathname || '';
  for (let i = 0; i < allow.length; i++) if (path.includes(allow[i])) return;
  if (!isLoggedIn()) {
    window.location.replace(resolveSitePath('login.html'));
  }
}

function handleAccountClick() {
  if (window.authService && typeof window.authService.openAccount === 'function') {
    window.authService.openAccount();
    return;
  }
  if (isLoggedIn()) {
    window.location.href = resolveSitePath('account/account.html');
  } else {
    window.location.href = resolveSitePath('login.html');
  }
}

window.saveData = saveData;
window.getData = getData;
window.removeData = removeData;
window.saveUser = saveUser;
window.getUser = getUser;
window.removeUser = removeUser;
window.saveSession = saveSession;
window.getSession = getSession;
window.clearSession = clearSession;
window.redirectIfNotAuth = redirectIfNotAuth;
window.resolveSitePath = resolveSitePath;

if (!(window.authService && typeof window.authService.isLoggedIn === 'function')) {
  window.isLoggedIn = isLoggedIn;
  window.loginUser = loginUser;
  window.logoutUser = logoutUserFull;
  window.handleAccountClick = handleAccountClick;
}