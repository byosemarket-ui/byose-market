(function(){
  try {
    function getSitePrefix() {
      var path = (window.location && window.location.pathname) || '';
      if (path.indexOf('/account/settings/') !== -1) return '../../';
      if (
        path.indexOf('/account/') !== -1 ||
        path.indexOf('/logout/') !== -1 ||
        path.indexOf('/components/') !== -1 ||
        path.indexOf('/details/') !== -1 ||
        path.indexOf('/shop/') !== -1 ||
        path.indexOf('/auth/') !== -1
      ) return '../';
      return '';
    }

    function appendScript(path, onload) {
      var script = document.createElement('script');
      script.src = getSitePrefix() + path;
      script.async = false;
      if (typeof onload === 'function') {
        script.onload = onload;
      }
      document.head.appendChild(script);
    }

    if (!window.authService) {
      appendScript('services/authservice.js');
    }

    if (!window.authService || !(window.handleAccountClick && window.isLoggedIn)) {
      appendScript('account/shared/storage.js');
    }

    if (!window.__byoseTrackerRequested) {
      window.__byoseTrackerRequested = true;
      appendScript('js/tracker.js', function () {
        if (window.__byoseTrackerStarted || !window.Tracker || typeof window.Tracker.startVisit !== 'function') {
          return;
        }
        window.__byoseTrackerStarted = true;
        window.Tracker.startVisit();
      });
    }
  } catch (e) {
    console.error('Failed to load shared site bridges', e);
  }
})();
