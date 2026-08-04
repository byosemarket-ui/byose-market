// Centralized logout handler for the app
(function () {
  const confirmBtn = document.getElementById('confirmBtn');
  const cancelBtn = document.getElementById('cancelBtn');

  function sitePath(target) {
    return '../' + String(target || '').replace(/^\/+/, '');
  }

  function performLogout() {
    try {
      if (window.authService && typeof window.authService.logout === 'function') {
        window.authService.logout();
      }
    } catch (e) {}

    const authKeys = [
      'bm_auth_token',
      'bm_current_user',
      'bm_user',
      'byose_market_user',
      'bm_logged_in',
      'byose_market_session',
      'bm_session',
      'bm_remember_me'
    ];
    [localStorage, sessionStorage].forEach((storage) => {
      authKeys.forEach((key) => {
        try { storage.removeItem(key); } catch (e) {}
      });
    });
    // final redirect to homepage
    try { window.location.replace(sitePath('index.html')); } catch (e) { window.location.href = sitePath('index.html'); }
  }

  if (confirmBtn) confirmBtn.addEventListener('click', performLogout);
  if (cancelBtn) cancelBtn.addEventListener('click', function () {
    // navigate back if possible, else to account
    try { if (document.referrer) window.location.href = document.referrer; else window.location.href = sitePath('account/account.html'); } catch (e) { window.location.href = sitePath('account/account.html'); }
  });
})();
