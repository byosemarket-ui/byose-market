(function () {
  'use strict';

  let redirected = false;

  function getLoginPath() {
    const accountIndex = window.location.pathname.toLowerCase().lastIndexOf('/account/');
    if (accountIndex === -1) {
      return '../login.html';
    }

    const accountRelativePath = window.location.pathname.slice(accountIndex + '/account/'.length);
    const depth = accountRelativePath.split('/').filter(Boolean).length - 1;
    return `${'../'.repeat(Math.max(1, depth + 1))}login.html`;
  }

  function concealProtectedContent() {
    try {
      document.documentElement.setAttribute('data-bm-auth', 'blocked');
      document.documentElement.style.visibility = 'hidden';
      if (document.body) {
        document.body.style.visibility = 'hidden';
      }
    } catch (e) {}
  }

  function revealProtectedContent() {
    try {
      document.documentElement.setAttribute('data-bm-auth', 'ok');
      document.documentElement.style.visibility = '';
      if (document.body) {
        document.body.style.visibility = '';
      }
    } catch (e) {}
  }

  function redirectToLogin() {
    if (redirected) {
      return;
    }
    redirected = true;
    concealProtectedContent();
    const loginPath = getLoginPath();
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(`${loginPath}?next=${encodeURIComponent(next)}`);
  }

  function hasAuthService() {
    return Boolean(window.authService && typeof window.authService.isLoggedIn === 'function');
  }

  function hasLocalCredentials() {
    if (!hasAuthService()) {
      return false;
    }
    if (typeof window.authService.hasStoredCredentials === 'function') {
      return window.authService.hasStoredCredentials();
    }
    return window.authService.isLoggedIn();
  }

  function isAuthenticatedLocally() {
    return hasLocalCredentials() || (hasAuthService() && window.authService.isLoggedIn());
  }

  async function requireAuthenticatedAccount(options) {
    const fromCache = Boolean(options && options.fromCache);

    if (!hasAuthService()) {
      redirectToLogin();
      return;
    }

    if (fromCache) {
      concealProtectedContent();
    }

    if (!isAuthenticatedLocally()) {
      redirectToLogin();
      return;
    }

    try {
      if (!fromCache) {
        if (typeof window.authService.whenReady === 'function') {
          await window.authService.whenReady();
        } else if (typeof window.authService.restoreSession === 'function') {
          await window.authService.restoreSession();
        }
      }

      if (!isAuthenticatedLocally()) {
        redirectToLogin();
        return;
      }

      if (typeof window.authService.refreshCurrentUser === 'function') {
        await window.authService.refreshCurrentUser();
      }

      if (!window.authService.isLoggedIn()) {
        redirectToLogin();
        return;
      }

      revealProtectedContent();
    } catch (error) {
      if (window.authService.isLoggedIn() && hasLocalCredentials()) {
        revealProtectedContent();
        return;
      }
      redirectToLogin();
    }
  }

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      concealProtectedContent();
      requireAuthenticatedAccount({ fromCache: true });
      return;
    }
    if (!isAuthenticatedLocally()) {
      redirectToLogin();
    }
  });

  window.addEventListener('storage', () => {
    if (!hasAuthService()) {
      return;
    }
    if (!isAuthenticatedLocally()) {
      redirectToLogin();
    }
  });

  window.addEventListener('userUpdated', (event) => {
    if (!hasAuthService()) {
      return;
    }
    if (!event.detail && !isAuthenticatedLocally()) {
      redirectToLogin();
    }
  });

  if (!isAuthenticatedLocally()) {
    concealProtectedContent();
  }

  requireAuthenticatedAccount();
})();
