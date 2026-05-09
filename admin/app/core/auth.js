export function ensureAuthenticated() {
  const security = window.AdminSecurity;
  if (!security || typeof security.requireAuth !== "function") {
    return true;
  }

  return security.requireAuth();
}

export async function validateActiveSession() {
  const security = window.AdminSecurity;
  if (!security || typeof security.validateSession !== "function") {
    return true;
  }

  try {
    return await security.validateSession(false, { source: "admin-app-router" });
  } catch (_error) {
    return false;
  }
}

export function logout() {
  const security = window.AdminSecurity;
  if (security && typeof security.logout === "function") {
    security.logout();
    return;
  }

  window.location.replace("admin-login/admin-login.html");
}
