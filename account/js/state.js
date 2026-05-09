// ===============================
// 🧠 STATE MANAGEMENT SYSTEM
// ===============================

// ===============================
// 📦 GLOBAL STATE
// ===============================
const AppState = {
  user: null,
  theme: "light",
  language: "rw"
};

// ===============================
// 🔄 INIT STATE
// ===============================
function initState() {
  loadUser();
  loadThemeState();
  loadLanguageState();

  console.log("🧠 State Initialized:", AppState);
}

// ===============================
// 👤 USER STATE
// ===============================
function loadUser() {
  if (window.authService && typeof window.authService.getCurrentUser === 'function') {
    try { AppState.user = window.authService.getCurrentUser(); return; } catch (e) {}
  }

  if (typeof window.getCurrentUser === 'function') {
    try { AppState.user = window.getCurrentUser(); return; } catch (e) {}
  }
  AppState.user = null;
}

function setUser(user) {
  AppState.user = user;
  if (window.authService && typeof window.authService.setCurrentUser === 'function') {
    try { window.authService.setCurrentUser(user); return; } catch (e) {}
  }
  if (typeof window.setCurrentUser === 'function') { try { window.setCurrentUser(user); } catch (e) {} }
}

// ===============================
// 🎨 THEME STATE
// ===============================
function loadThemeState() {
  const theme = localStorage.getItem("bm_theme") || "light";
  AppState.theme = theme;
}

function setThemeState(theme) {
  AppState.theme = theme;
  localStorage.setItem("bm_theme", theme);
}

// ===============================
// 🌍 LANGUAGE STATE
// ===============================
function loadLanguageState() {
  const lang = localStorage.getItem("bm_lang") || "rw";
  AppState.language = lang;
}

function setLanguageState(lang) {
  AppState.language = lang;
  localStorage.setItem("bm_lang", lang);
}

// ===============================
// 🔍 GET STATE
// ===============================
function getState() {
  return AppState;
}

// ===============================
// 🚪 LOGOUT (GLOBAL)
// ===============================
function logoutState() {
  AppState.user = null;
  // Use centralized logout flow
  try { window.location.href = '../logout/logout.html'; } catch (e) { window.location.replace('../logout/logout.html'); }
}