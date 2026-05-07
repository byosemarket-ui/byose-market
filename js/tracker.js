/* Visitor Tracker — keeps the existing local cache, but also records visits in the backend. */
const Tracker = (function(){
  const KEY = 'byose_market_visitors_v1';

  function getStore(){
    try{ return JSON.parse(localStorage.getItem(KEY)) || []; }catch{ return []; }
  }

  function saveStore(v){
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {}
  }

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
      console.warn('Unable to record visit on the API.', error);
      return null;
    }
  }

  async function updateVisitOnServer(visit) {
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
      console.warn('Unable to update visit on the API.', error);
      return null;
    }
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

    const store = getStore();
    store.push(visitor);
    saveStore(store);

    void recordVisitOnServer(visitor);

    fetchGeo().then((geo) => {
      if(!geo) return;
      try{
        const all = getStore();
        const idx = all.findIndex(v=>v.id===visitor.id);
        if(idx>-1){
          all[idx].ip = geo.ip || null;
          all[idx].city = geo.city || null;
          all[idx].country = geo.country_name || null;
          all[idx].org = geo.org || null;
          saveStore(all);
          void updateVisitOnServer(all[idx]);
        }
      }catch(e){}
    }).catch(() => null);

    window.addEventListener('beforeunload', () => {
      try{
        const now = Date.now();
        const all = getStore();
        const idx = all.findIndex(v=>v.id===visitor.id);
        if(idx>-1){
          all[idx].duration = Math.round((now - all[idx].start)/1000);
          saveStore(all);
          void updateVisitOnServer(all[idx]);
        }
      }catch(e){}
    }, { once: true });
  }

  function getVisits(){ return getStore(); }
  function clearVisits(){ localStorage.removeItem(KEY); }

  return { startVisit, getVisits, clearVisits };
})();

// Expose globally
window.Tracker = Tracker;
