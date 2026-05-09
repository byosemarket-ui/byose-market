// Centralized logout handler for the app
(function () {
  const confirmBtn = document.getElementById('confirmBtn');
  const cancelBtn = document.getElementById('cancelBtn');

  function sitePath(target) {
    return '../' + String(target || '').replace(/^\/+/, '');
  }

  function performLogout() {
    try { localStorage.removeItem('bm_token'); } catch (e) {}
    try { localStorage.removeItem('bm_logged_in'); } catch (e) {}
    try { localStorage.removeItem('bm_current_user'); } catch (e) {}
    try { localStorage.removeItem('bm_user'); } catch (e) {}
    try { localStorage.removeItem('bm_session'); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
    // best-effort: call central authService logout if available (clears session records)
    try { if (typeof authService !== 'undefined' && typeof authService.logout === 'function') authService.logout(); } catch (e) {}
    // final redirect to homepage
    try { window.location.replace(sitePath('index.html')); } catch (e) { window.location.href = sitePath('index.html'); }
  }

  if (confirmBtn) confirmBtn.addEventListener('click', performLogout);
  if (cancelBtn) cancelBtn.addEventListener('click', function () {
    // navigate back if possible, else to account
    try { if (document.referrer) window.location.href = document.referrer; else window.location.href = sitePath('account/account.html'); } catch (e) { window.location.href = sitePath('account/account.html'); }
  });
})();
