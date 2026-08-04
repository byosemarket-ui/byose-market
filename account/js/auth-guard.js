(function () {
  'use strict';

  function getLoginPath() {
    const accountIndex = window.location.pathname.toLowerCase().lastIndexOf('/account/');
    if (accountIndex === -1) {
      return '../login.html';
    }

    const accountRelativePath = window.location.pathname.slice(accountIndex + '/account/'.length);
    const depth = accountRelativePath.split('/').filter(Boolean).length - 1;
    return `${'../'.repeat(Math.max(1, depth + 1))}login.html`;
  }

  function redirectToLogin() {
    const loginPath = getLoginPath();
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(`${loginPath}?next=${encodeURIComponent(next)}`);
  }

  function requireAuthenticatedAccount() {
    if (!window.authService || typeof window.authService.isLoggedIn !== 'function') {
      redirectToLogin();
      return;
    }

    if (!window.authService.isLoggedIn()) {
      redirectToLogin();
      return;
    }

    window.authService.refreshCurrentUser().catch(() => {
      redirectToLogin();
    });
  }

  requireAuthenticatedAccount();
})();
