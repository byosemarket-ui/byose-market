/* Visitor Tracker — records visits in the backend without browser-local ownership. */
const Tracker = (function(){
  let currentVisit = null;
  let recentVisits = [];

  function detectDevice(){
    const ua = navigator.userAgent || '';
    const width = window.innerWidth || 0;
    if(/Mobi|Android/i.test(ua) || width <= 640) return 'mobile';
    if(width <= 1024) return 'tablet';
    return 'desktop';
  }

  function resolveApiOrigin(){
    if (window.ByoseStorefrontSync && typeof window.ByoseStorefrontSync.resolveApiOrigin === 'function') {
      return window.ByoseStorefrontSync.resolveApiOrigin();
    }
    return String(window.location?.origin || '').replace(/\/+$/, '');
  }

  function getActivityApiUrl(){
    const base = resolveApiOrigin();
    if (!base) return '';
    return base.endsWith('/api') ? `${base}/activity` : `${base}/api/activity`;
  }

  function shouldSkipActivityApi() {
	const hostname = String(window.location?.hostname || '').toLowerCase();
	return hostname === '127.0.0.1' || hostname === 'localhost';
  }

  function readCurrentUser(){
    try {
      if (window.authService && typeof window.authService.getCurrentUser === 'function') {
        return window.authService.getCurrentUser() || null;
      }
    } catch (error) {}

    try {
      return JSON.parse(localStorage.getItem('bm_current_user') || localStorage.getItem('bm_user') || 'null');
    } catch (error) {
      return null;
    }
  }

  async function fetchGeo(){
    try{
      const resp = await fetch('https://ipapi.co/json/');
      if(!resp.ok) return null;
      return await resp.json();
    }catch(e){ return null; }
  }

  async function recordVisitOnServer(visit) {
    if (shouldSkipActivityApi()) {
      return null;
    }

    const endpoint = getActivityApiUrl();
    if (!endpoint) {
      return null;
    }

    const token = window.ByoseStorefrontSync?.getToken?.() || '';

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          clientActivityId: visit.id,
          sessionId: visit.id,
          eventType: 'visit',
          path: visit.path,
          referrer: visit.referrer,
          userAgent: visit.userAgent,
          device: visit.device,
          duration: visit.duration,
          userId: visit.userId,
          startedAt: visit.timestamp,
          city: visit.city,
          country: visit.country,
          org: visit.org,
          ip: visit.ip,
          meta: {
            screen: visit.screen,
            viewport: visit.viewport
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Activity API failed with status ${response.status}`);
      }

      return await response.json().catch(() => null);
    } catch (error) {
	  if (!shouldSilenceActivityError(error)) {
		console.warn('Unable to record visit on the API.', error);
	  }
      return null;
    }
  }

  async function updateVisitOnServer(visit) {
    if (shouldSkipActivityApi()) {
      return null;
    }

    const endpoint = getActivityApiUrl();
    if (!endpoint || !visit?.id) {
      return null;
    }

    const token = window.ByoseStorefrontSync?.getToken?.() || '';

    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(visit.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          duration: visit.duration,
          endedAt: new Date().toISOString(),
          city: visit.city,
          country: visit.country,
          org: visit.org,
          ip: visit.ip,
          meta: {
            screen: visit.screen,
            viewport: visit.viewport
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Activity update failed with status ${response.status}`);
      }

      return await response.json().catch(() => null);
    } catch (error) {
	  if (!shouldSilenceActivityError(error)) {
		console.warn('Unable to update visit on the API.', error);
	  }
      return null;
    }
  }

  function shouldSilenceActivityError(error) {
	const message = String(error?.message || error || '').toLowerCase();
	return /status 404|failed to fetch|networkerror|load failed|err_aborted/.test(message);
  }

  async function startVisit(){
    const start = Date.now();
    const currentUser = readCurrentUser();
    const visitor = {
      id: `v_${start}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date(start).toISOString(),
      start,
      path: location.pathname + location.search,
      userAgent: navigator.userAgent,
      device: detectDevice(),
      ip: null,
      city: null,
      country: null,
      org: null,
      duration: 0,
      userId: currentUser && currentUser.id ? currentUser.id : null,
      referrer: document.referrer || null,
      screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
      viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`
    };

    currentVisit = visitor;
    recentVisits = [visitor];

    void recordVisitOnServer(visitor);

    fetchGeo().then((geo) => {
      if(!geo) return;
      try{
        if(!currentVisit || currentVisit.id !== visitor.id) return;
        currentVisit.ip = geo.ip || null;
        currentVisit.city = geo.city || null;
        currentVisit.country = geo.country_name || null;
        currentVisit.org = geo.org || null;
        recentVisits = [currentVisit];
        void updateVisitOnServer(currentVisit);
      }catch(e){}
    }).catch(() => null);

    window.addEventListener('beforeunload', () => {
      try{
        const now = Date.now();
        if(!currentVisit || currentVisit.id !== visitor.id) return;
        currentVisit.duration = Math.round((now - currentVisit.start)/1000);
        recentVisits = [currentVisit];
        void updateVisitOnServer(currentVisit);
      }catch(e){}
    }, { once: true });
  }

  function getVisits(){ return recentVisits.slice(); }
  function clearVisits(){ recentVisits = []; currentVisit = null; }

  return { startVisit, getVisits, clearVisits };
})();

// Expose globally
window.Tracker = Tracker;
