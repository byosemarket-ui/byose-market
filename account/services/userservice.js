// ===============================
// 🔥 USER SERVICE
// ===============================

// ===============================
// 📦 BASE API URL (use local API namespace)
// ===============================
const API_URL = "/api";

// ===============================
// 👤 GET USER (LOCAL)
// ===============================
function getUser() {
  if (typeof window.getCurrentUser === 'function') {
    try { return window.getCurrentUser(); } catch (e) {}
  }
  try { return JSON.parse(localStorage.getItem("bm_user")); } catch (e) { return null; }
}

// ===============================
// 💾 SAVE USER
// ===============================
function saveUser(user) {
  if (typeof window.setCurrentUser === 'function') {
    try { window.setCurrentUser(user); return; } catch (e) {}
  }
  localStorage.setItem("bm_user", JSON.stringify(user));
  try { localStorage.setItem("bm_current_user", JSON.stringify(user)); } catch (e) {}
  try { localStorage.setItem("byose_market_user", JSON.stringify(user)); } catch (e) {}

  try {
    const rawUsers = localStorage.getItem("bm_users") || localStorage.getItem("byose_market_users");
    const users = rawUsers ? JSON.parse(rawUsers) : [];
    const email = String(user?.email || "").trim().toLowerCase();
    const phone = String(user?.phone || "").trim();
    const index = Array.isArray(users)
      ? users.findIndex((entry) => {
          const entryEmail = String(entry?.email || "").trim().toLowerCase();
          const entryPhone = String(entry?.phone || "").trim();
          return (email && entryEmail === email)
            || (phone && entryPhone === phone)
            || (user?.id && String(entry?.id || "") === String(user.id));
        })
      : -1;

    const nextUsers = Array.isArray(users) ? users.slice() : [];
    if (index === -1) nextUsers.push(user);
    else nextUsers[index] = { ...nextUsers[index], ...user };

    localStorage.setItem("bm_users", JSON.stringify(nextUsers));
    localStorage.setItem("byose_market_users", JSON.stringify(nextUsers));
  } catch (e) {
    console.error("Save User Sync Error:", e);
  }
}

// ===============================
// 🔄 UPDATE PROFILE
// ===============================
async function updateProfile(data) {
  try {
    if (typeof authService !== 'undefined' && typeof authService.updateProfile === 'function') {
      const user = await authService.updateProfile(data || {});
      saveUser(user);
      return user;
    }

    const fetchFn = (typeof authService !== 'undefined' && typeof authService.authFetch === 'function') ? authService.authFetch : fetch;
    const response = await fetchFn(`${API_URL}/auth/me`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const result = await response.json();
    if (result.success) { saveUser(result.user); return result.user; }
    throw new Error(result.message || 'update_failed');
  } catch (error) {
    console.error("Update Error:", error);
  }
}

// ===============================
// 🚪 LOGOUT
// ===============================
function logout() {
  // Redirect to centralized logout page for confirmation and session cleanup
  try { window.location.href = '../logout/logout.html'; } catch (e) { window.location.replace('../logout/logout.html'); }
}

// ===============================
// 🔍 CHECK LOGIN
// ===============================
function isLoggedIn() {
  if (typeof window.isLoggedIn === 'function') {
    try { return !!window.isLoggedIn(); } catch (e) {}
  }
  return !!localStorage.getItem("bm_user");
}