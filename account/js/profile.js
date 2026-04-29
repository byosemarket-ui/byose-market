// ===============================
// Profile module — improved and non-destructive
// ===============================

(function () {
  const DEFAULT_AVATAR = "../assets/default-avatar.png";

  // DOM
  const usernameEl = document.getElementById("username");
  const profileImageEl = document.getElementById("profileImage");
  const uploadInput = document.getElementById("uploadImage");
  const profileWrapper = document.getElementById("profileWrapper");
  const editBtn = document.getElementById("editProfileBtn");
  const userInfo = document.querySelector('.user-info');

  // Local keys used historically in this project (support multiple)
  const FALLBACK_KEYS = ["byose_market_user", "bm_user", "user"];

  // ephemeral edited data
  let editing = false;
  let draft = null;

  // -------------------------------
  // Utility: read user from available apis
  // -------------------------------
  function readUser() {
    try {
      // Prefer global state if available
      if (typeof getState === 'function') {
        const s = getState();
        if (s && s.user) return s.user;
      }

      // storage.js API
      if (typeof getUser === 'function') {
        const u = getUser();
        if (u) return u;
      }

      // fallback localStorage keys
      for (const k of FALLBACK_KEYS) {
        const raw = localStorage.getItem(k);
        if (raw) {
          try { return JSON.parse(raw); } catch (e) { return null; }
        }
      }

      return null;
    } catch (e) {
      console.warn('readUser failed', e);
      return null;
    }
  }

  // -------------------------------
  // Utility: persist user through available apis
  // -------------------------------
  function writeUser(user) {
    try {
      // Update global state if present
      if (typeof setUser === 'function') {
        try { setUser(user); } catch (e) { console.warn('setUser failed', e); }
      }

      // storage.js API
      if (typeof saveUser === 'function') {
        try { saveUser(user); } catch (e) { /* ignore */ }
      }

      // last-resort: write fallback keys
      try { localStorage.setItem('byose_market_user', JSON.stringify(user)); } catch (e) {}
      try { localStorage.setItem('bm_user', JSON.stringify(user)); } catch (e) {}
      try { localStorage.setItem('bm_current_user', JSON.stringify(user)); } catch (e) {}

      // also set a simple user entry used in other places
      try { localStorage.setItem('user', JSON.stringify(user)); } catch (e) {}

      const rawUsers = localStorage.getItem('bm_users') || localStorage.getItem('byose_market_users');
      const users = rawUsers ? JSON.parse(rawUsers) : [];
      const email = String(user && user.email || '').trim().toLowerCase();
      const phone = String(user && user.phone || '').trim();
      const index = Array.isArray(users)
        ? users.findIndex((entry) => {
            const entryEmail = String(entry && entry.email || '').trim().toLowerCase();
            const entryPhone = String(entry && entry.phone || '').trim();
            return (email && entryEmail === email)
              || (phone && entryPhone === phone)
              || (user && user.id && String(entry && entry.id || '') === String(user.id));
          })
        : -1;

      const nextUsers = Array.isArray(users) ? users.slice() : [];
      if (index === -1) {
        nextUsers.push(user);
      } else {
        nextUsers[index] = {
          ...nextUsers[index],
          ...user
        };
      }

      try { localStorage.setItem('bm_users', JSON.stringify(nextUsers)); } catch (e) {}
      try { localStorage.setItem('byose_market_users', JSON.stringify(nextUsers)); } catch (e) {}

      // dispatch an app-level event so other modules can react
      window.dispatchEvent(new CustomEvent('userUpdated', { detail: user }));
      window.dispatchEvent(new CustomEvent('byose:customers-changed', { detail: { action: 'profile-update', userId: user && user.id || '' } }));
    } catch (e) {
      console.error('writeUser failed', e);
    }
  }

  // -------------------------------
  // Wrap existing global setUser to emit events (non-destructive)
  // -------------------------------
  (function wrapSetUser() {
    if (typeof window.setUser === 'function' && !window.setUser.__wrappedByProfile) {
      const orig = window.setUser;
      const wrapped = function (u) {
        const res = orig.apply(this, arguments);
        try { window.dispatchEvent(new CustomEvent('userUpdated', { detail: u })); } catch (e) {}
        return res;
      };
      wrapped.__wrappedByProfile = true;
      window.setUser = wrapped;
    }
  })();

  // -------------------------------
  // UI: ensure email/phone display exists
  // -------------------------------
  let contactEl = document.getElementById('accountContact');
  if (!contactEl) {
    contactEl = document.createElement('div');
    contactEl.id = 'accountContact';
    contactEl.style.fontSize = '13px';
    contactEl.style.opacity = '0.9';
    contactEl.style.marginTop = '4px';
    if (userInfo) userInfo.appendChild(contactEl);
  }

  // optional inline status message
  let statusEl = document.getElementById('profileStatus');
  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.id = 'profileStatus';
    statusEl.style.fontSize = '13px';
    statusEl.style.color = '#2a7f2a';
    statusEl.style.marginTop = '6px';
    statusEl.style.display = 'none';
    if (userInfo) userInfo.appendChild(statusEl);
  }

  // -------------------------------
  // Render user into UI
  // -------------------------------
  function render(user) {
    const u = user || readUser();

    if (!u) {
      // Not logged in -> redirect to login
      try { window.location.href = '../../login.html'; } catch (e) {}
      return;
    }

    // name
    usernameEl.textContent = u.name || u.username || u.email || 'User';

    // contact
    const contact = u.email || u.phone || '';
    contactEl.textContent = contact;

    // avatar
    if (u.avatar) profileImageEl.src = u.avatar; else profileImageEl.src = DEFAULT_AVATAR;
  }

  // -------------------------------
  // Image upload handling with preview
  // -------------------------------
  function handleImageFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('no-file'));
      if (!file.type.startsWith('image/')) return reject(new Error('not-an-image'));
      const r = new FileReader();
      r.onload = function (e) { resolve(e.target.result); };
      r.onerror = () => reject(new Error('read-error'));
      r.readAsDataURL(file);
    });
  }

  function onUploadChange(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    handleImageFile(file).then(base64 => {
      // set preview immediately
      profileImageEl.src = base64;
      // set in draft if editing, otherwise save directly
      if (editing && draft) {
        draft.avatar = base64;
      } else {
        const current = readUser() || {};
        current.avatar = base64;
        writeUser(current);
        showStatus('Profile image updated');
      }
    }).catch(err => {
      alert('Failed to read image file.');
    });
  }

  // -------------------------------
  // Edit flow: create form elements on demand
  // -------------------------------
  let formRow = null;

  function enterEdit() {
    if (editing) return;
    const u = readUser();
    if (!u) return;
    editing = true;
    draft = Object.assign({}, u);

    // create form row
    formRow = document.createElement('div');
    formRow.className = 'profile-edit-row';
    formRow.style.display = 'flex';
    formRow.style.flexDirection = 'column';
    formRow.style.gap = '8px';
    formRow.style.marginTop = '8px';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Full name';
    nameInput.value = draft.name || '';
    nameInput.style.padding = '8px';
    nameInput.style.borderRadius = '6px';
    nameInput.style.border = '1px solid #ddd';

    const contactInput = document.createElement('input');
    contactInput.type = 'text';
    contactInput.placeholder = 'Email or phone';
    contactInput.value = draft.email || draft.phone || '';
    contactInput.style.padding = '8px';
    contactInput.style.borderRadius = '6px';
    contactInput.style.border = '1px solid #ddd';

    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.gap = '8px';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.className = 'btn btn-primary';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'btn';

    const changeImageBtn = document.createElement('button');
    changeImageBtn.textContent = 'Change Image';
    changeImageBtn.className = 'btn';

    buttons.appendChild(saveBtn);
    buttons.appendChild(cancelBtn);
    buttons.appendChild(changeImageBtn);

    formRow.appendChild(nameInput);
    formRow.appendChild(contactInput);
    formRow.appendChild(buttons);

    if (userInfo) userInfo.appendChild(formRow);

    // events
    changeImageBtn.addEventListener('click', () => uploadInput.click());

    saveBtn.addEventListener('click', () => {
      // validate minimal
      const name = nameInput.value && nameInput.value.trim();
      const contact = contactInput.value && contactInput.value.trim();
      if (!name) { alert('Please enter your name.'); return; }
      draft.name = name;
      // determine if contact looks like email or phone
      if (contact) {
        if (contact.indexOf('@') > -1) { draft.email = contact; delete draft.phone; }
        else { draft.phone = contact; delete draft.email; }
      }

      // persist
      writeUser(draft);
      exitEdit(true);
      showStatus('Profile updated');
    });

    cancelBtn.addEventListener('click', () => {
      exitEdit(false);
    });

    // allow Enter to save on name
    nameInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') saveBtn.click(); });
  }

  function exitEdit(saved) {
    editing = false;
    draft = null;
    if (formRow && formRow.parentNode) formRow.parentNode.removeChild(formRow);
    formRow = null;
    // re-render from authoritative source
    render();
    if (!saved) showStatus('Edit cancelled', true);
  }

  // -------------------------------
  // Small status helper
  // -------------------------------
  let statusTimer = null;
  function showStatus(msg, hideQuick) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.display = 'block';
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusEl.style.display = 'none';
    }, hideQuick ? 1500 : 2500);
  }

  // -------------------------------
  // Events & initialization
  // -------------------------------
  function init() {
    // protect: must have user, otherwise redirect
    const user = readUser();
    if (!user) {
      try { window.location.href = '../../login.html'; } catch (e) {}
      return;
    }

    render(user);

    // wire interactions
    if (profileWrapper) profileWrapper.addEventListener('click', () => uploadInput.click());
    if (uploadInput) uploadInput.addEventListener('change', onUploadChange);
    if (editBtn) editBtn.addEventListener('click', (ev) => { ev.stopPropagation(); enterEdit(); });

    // live update hooks
    window.addEventListener('userUpdated', (e) => render(e.detail));
    window.addEventListener('storage', (e) => {
      // when other tabs update user data
      if (!e.key) { render(); return; }
      if (['byose_market_user','bm_user','user'].includes(e.key)) render();
    });
  }

  document.addEventListener('DOMContentLoaded', init);

})();