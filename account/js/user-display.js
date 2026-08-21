(function (global) {
  'use strict';

  function text(value) {
    return String(value || '').trim();
  }

  function resolveAvatarUrl(avatar) {
    const raw = text(avatar);
    if (!raw) return '';
    if (/^(?:https?:|data:|blob:)/i.test(raw)) return raw;
    if (raw.startsWith('/uploads/')) return raw;
    if (raw.startsWith('uploads/')) return `/${raw}`;
    if (/^(?:users|products|categories|reviews|hero|temp)\//i.test(raw)) return `/uploads/${raw}`;
    if (raw.startsWith('/')) return raw;
    return raw;
  }

  function getNameInitial(name) {
    const first = text(name).split(/\s+/).filter(Boolean)[0] || '';
    const letter = first.charAt(0).toUpperCase();
    return /[A-Z0-9]/i.test(letter) ? letter : 'B';
  }

  function formatMemberSince(createdAt) {
    if (!createdAt) return '';
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function paintAvatar(container, user, options = {}) {
    if (!container) return;
    const name = text(user?.name) || 'Customer';
    const url = resolveAvatarUrl(user?.avatar || user?.profileImage || user?.image);
    const initial = getNameInitial(name);
    container.replaceChildren();

    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = `${name} avatar`;
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        container.replaceChildren();
        const fallback = document.createElement('span');
        fallback.className = options.initialClass || 'avatar-initial';
        fallback.textContent = initial;
        fallback.setAttribute('aria-hidden', 'true');
        container.append(fallback);
      });
      container.append(img);
      return;
    }

    const fallback = document.createElement('span');
    fallback.className = options.initialClass || 'avatar-initial';
    fallback.textContent = initial;
    fallback.setAttribute('aria-hidden', 'true');
    container.append(fallback);
  }

  global.ByoseCustomerProfileUi = {
    text,
    resolveAvatarUrl,
    getNameInitial,
    formatMemberSince,
    paintAvatar
  };
})(window);
