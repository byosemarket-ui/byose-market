// Centralized logout handler for the app
(function () {
  const confirmBtn = document.getElementById('confirmBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const AUTH_KEYS = [
    'bm_refresh_token',
    'bm_auth_token',
    'bm_current_user',
    'bm_user',
    'byose_market_user',
    'bm_logged_in',
    'byose_market_session',
    'bm_session',
    'bm_remember_me'
  ];

  function sitePath(target) {
    return '../' + String(target || '').replace(/^\/+/, '');
  }

  function clearLocalAuth() {
    [localStorage, sessionStorage].forEach((storage) => {
      AUTH_KEYS.forEach((key) => {
        try { storage.removeItem(key); } catch (e) {}
      });
    });
  }

  function redirectHome() {
    const home = sitePath('index.html');
    try { window.location.replace(home); } catch (e) { window.location.href = home; }
  }

  async function performLogout() {
    if (confirmBtn) confirmBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;

    const logoutPromise = (window.authService && typeof window.authService.logout === 'function')
      ? Promise.resolve(window.authService.logout()).catch(function () {})
      : Promise.resolve();

    try {
      await Promise.race([
        logoutPromise,
        new Promise(function (resolve) { setTimeout(resolve, 4000); })
      ]);
    } catch (e) {}

    clearLocalAuth();
    redirectHome();
  }

  if (confirmBtn) confirmBtn.addEventListener('click', function () {
    performLogout();
  });
  if (cancelBtn) cancelBtn.addEventListener('click', function () {
    try {
      if (document.referrer) window.location.href = document.referrer;
      else window.location.href = sitePath('account/account.html');
    } catch (e) {
      window.location.href = sitePath('account/account.html');
    }
  });
})();
