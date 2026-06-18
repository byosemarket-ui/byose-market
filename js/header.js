/* ========================================
   HEADER & NAVIGATION LOGIC
   ======================================== */

document.addEventListener('DOMContentLoaded', () => {
  setupStickyHeader();
  setupSearchForms();
  setupDesktopSearchToggle();
  setupHomeSearchRedirect();
  setupFooterSubscribe();

  // MOBILE MENU TOGGLE
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileMenu = document.getElementById('mobileMenu');

  if (mobileMenuBtn && mobileMenu) {
    mobileMenuBtn.addEventListener('click', () => {
      const isActive = mobileMenu.classList.toggle('active');
      mobileMenuBtn.classList.toggle('active');
      mobileMenuBtn.setAttribute('aria-expanded', isActive);
      document.body.style.overflow = isActive ? 'hidden' : '';
    });

    // Close menu when clicking on a link
    document.querySelectorAll('.mobile-nav-link').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.remove('active');
        mobileMenuBtn.classList.remove('active');
        mobileMenuBtn.setAttribute('aria-expanded', false);
        document.body.style.overflow = '';
      });
    });
  }

  // ACTIVE NAV LINK
  setActiveNavLink();
  window.addEventListener('popstate', setActiveNavLink);

  // CART BUTTON
  const cartBtn = document.getElementById('cartBtn');
  if (cartBtn) {
    if (document.getElementById('cartSidebar')) {
      cartBtn.addEventListener('click', () => Cart.openCart());
    } else {
      cartBtn.addEventListener('click', () => window.location.href = 'cart.html');
    }
  }

  // WISHLIST BUTTON
  const wishlistBtn = document.getElementById('wishlistBtn');
  if (wishlistBtn) {
    wishlistBtn.addEventListener('click', () => {
      updateWishlistBadge();
    });
  }

  // ACCOUNT BUTTON (desktop)
  const accountBtn = document.getElementById('accountBtn');
  if (accountBtn) {
    accountBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof handleAccountClick === 'function') return handleAccountClick();
      if (typeof window.handleAccountClick === 'function') return window.handleAccountClick();
      // fallback
      window.location.href = resolveHeaderPath('login.html');
    });
    // render avatar if available
    (function renderAccountAvatar(){
      try {
        let u = null;
        if (typeof window.getCurrentUser === 'function') {
          try { u = window.getCurrentUser(); } catch (e) { u = null; }
        }
        if (!u) {
          const raw = localStorage.getItem('bm_user');
          if (!raw) return;
          u = JSON.parse(raw);
        }
        if (!u) return;
        if (u.avatar) {
          accountBtn.innerHTML = `<img src="${u.avatar}" class="header-avatar" alt="${(u.name||'User')}">`;
        } else if (u.name) {
          const letter = (u.name||'U').trim()[0].toUpperCase();
          accountBtn.innerHTML = `<div class="header-avatar header-avatar--letter">${letter}</div>`;
        }
          // accessible title with name, contact and id
          try {
            const contact = u.email || u.phone || '';
            const id = u.id ? (' • ' + u.id) : '';
            accountBtn.setAttribute('title', `${u.name || 'User'}${contact ? ' — ' + contact : ''}${id}`);
          } catch (e) {}
      } catch (e) { /* ignore */ }
    })();
  }

  // ACCOUNT LINK (mobile menu)
  const mobileAccountLink = document.getElementById('mobileAccountLink');
  if (mobileAccountLink) {
    mobileAccountLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof handleAccountClick === 'function') return handleAccountClick();
      if (typeof window.handleAccountClick === 'function') return window.handleAccountClick();
      window.location.href = resolveHeaderPath('login.html');
    });
  }

  // Find any legacy anchors pointing to login.html and wire them to shared handler
  document.querySelectorAll('a.icon-btn[href$="login.html"], a[href$="login.html"]').forEach(a => {
    a.addEventListener('click', (e) => {
      // only intercept if it's an account link (contains user icon or aria-label)
      const hasUserIcon = a.querySelector('.fa-user') || a.querySelector('.fa-regular') || a.querySelector('.fa-solid');
      const aria = (a.getAttribute('aria-label') || '').toLowerCase();
      if (!aria.includes('account') && !hasUserIcon) return; // leave other login links alone
      e.preventDefault();
      if (typeof handleAccountClick === 'function') return handleAccountClick();
      if (typeof window.handleAccountClick === 'function') return window.handleAccountClick();
      window.location.href = resolveHeaderPath('login.html');
    });
  });
});

function resolveHeaderPath(target) {
  const path = window.location.pathname || '';
  if (path.includes('/account/settings/')) return '../../' + target;
  if (path.includes('/account/') || path.includes('/logout/') || path.includes('/components/') || path.includes('/details/') || path.includes('/shop/') || path.includes('/auth/')) return '../' + target;
  return target;
}

/**
 * SET ACTIVE NAV LINK BASED ON CURRENT PAGE
 */
function setActiveNavLink() {
  const currentPage = getCurrentPage();
  document.querySelectorAll('.nav-link, .nav a').forEach(link => {
    const page = link.dataset.page || link.getAttribute('href').split('/').pop().replace('.html', '');
    link.classList.toggle('active', page === currentPage);
  });
}

/**
 * GET CURRENT PAGE NAME
 */
function getCurrentPage() {
  const pathname = window.location.pathname;
  const filename = pathname.split('/').pop() || 'index.html';
  return filename.replace('.html', '').replace(/^index$/, 'home');
}

/**
 * UPDATE WISHLIST BADGE
 */
function updateWishlistBadge() {
  const wishlist = getStorageList('byose_market_wishlist');
  const badge = document.getElementById('wishlistBadge');
  if (badge) {
    badge.textContent = wishlist.length;
    badge.style.display = wishlist.length > 0 ? 'flex' : 'none';
  }
}

/**
 * ADD TO WISHLIST
 */
function addToWishlist(product) {
  const wishlist = getStorageList('byose_market_wishlist');
  const exists = wishlist.some(item => item.id === product.id);

  if (!exists) {
    wishlist.push({
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
    });
    setStorageList('byose_market_wishlist', wishlist);
    showFeedback('success', 'Added to wishlist!');
  } else {
    showFeedback('warning', 'Already in wishlist');
  }

  updateWishlistBadge();
}

/**
 * REMOVE FROM WISHLIST
 */
function removeFromWishlist(productId) {
  let wishlist = getStorageList('byose_market_wishlist');
  wishlist = wishlist.filter(item => item.id !== productId);
  setStorageList('byose_market_wishlist', wishlist);
  showFeedback('info', 'Removed from wishlist');
  updateWishlistBadge();
}

/**
 * TOGGLE WISHLIST STATUS
 */
function toggleWishlist(productId, product) {
  const wishlist = getStorageList('byose_market_wishlist');
  const exists = wishlist.some(item => item.id === productId);

  if (exists) {
    removeFromWishlist(productId);
  } else {
    addToWishlist(product);
  }
}

// Update badges on load
updateWishlistBadge();

function setupStickyHeader() {
  const header = document.querySelector('[data-sticky-header]') || document.querySelector('.main-header');
  if (!header) {
    return;
  }

  const sync = () => {
    header.classList.toggle('is-scrolled', window.scrollY > 8);
  };

  sync();
  window.addEventListener('scroll', sync, { passive: true });
}

function setupSearchForms() {
  const forms = document.querySelectorAll('#searchForm, .site-search');
  forms.forEach(form => {
    const input = form.querySelector('#searchInput, input[type="search"], input[name="q"]');

    if (input) {
      input.addEventListener('focus', () => {
        form.classList.add('is-focused');
      });

      input.addEventListener('blur', () => {
        form.classList.remove('is-focused');
      });
    }

    form.addEventListener('submit', event => {
      event.preventDefault();
      const query = input ? input.value.trim() : '';
      if (!query) {
        if (input) {
          input.focus();
        }
        return;
      }
      window.location.href = `search.html?q=${encodeURIComponent(query)}`;
    });
  });
}

function setupDesktopSearchToggle() {
  const toggle = document.getElementById('desktopSearchToggle');
  const form = document.getElementById('searchForm');
  const headerShell = toggle ? toggle.closest('.header-shell') : null;
  const input = form ? form.querySelector('#searchInput, input[type="search"], input[name="q"]') : null;

  if (!toggle || !form || !headerShell) {
    return;
  }

  const isDesktop = () => window.matchMedia('(min-width: 769px)').matches;

  const closeSearch = () => {
    headerShell.classList.remove('search-open');
    toggle.classList.remove('is-active');
    toggle.setAttribute('aria-expanded', 'false');
  };

  const openSearch = () => {
    if (!isDesktop()) {
      window.location.href = 'search.html';
      return;
    }

    headerShell.classList.add('search-open');
    toggle.classList.add('is-active');
    toggle.setAttribute('aria-expanded', 'true');
    if (input) {
      window.requestAnimationFrame(() => input.focus());
    }
  };

  toggle.addEventListener('click', event => {
    event.preventDefault();
    if (headerShell.classList.contains('search-open')) {
      closeSearch();
      return;
    }
    openSearch();
  });

  document.addEventListener('click', event => {
    if (!isDesktop() || !headerShell.classList.contains('search-open')) {
      return;
    }

    if (headerShell.contains(event.target)) {
      return;
    }

    closeSearch();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeSearch();
    }
  });

  window.addEventListener('resize', () => {
    if (!isDesktop()) {
      closeSearch();
    }
  });
}

function setupHomeSearchRedirect() {
  const trigger = document.getElementById('homeSearchRedirect');
  const input = document.getElementById('homeSearchInput');

  if (!trigger || !input) {
    return;
  }

  const placeholders = [
    'Search shoes...',
    'Search phones...',
    'Search bags...'
  ];

  let activeIndex = 0;
  input.placeholder = placeholders[activeIndex];

  window.setInterval(() => {
    activeIndex = (activeIndex + 1) % placeholders.length;
    input.placeholder = placeholders[activeIndex];
  }, 2600);

  const openSearchPage = () => {
    window.location.href = 'search.html';
  };

  trigger.addEventListener('click', openSearchPage);

  trigger.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openSearchPage();
    }
  });

  input.addEventListener('focus', event => {
    event.preventDefault();
    trigger.focus();
    openSearchPage();
  });
}

function getStorageList(key) {
  try {
    if (typeof Util !== 'undefined' && typeof Util.getFromStorage === 'function') {
      return Util.getFromStorage(key, []);
    }
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch (error) {
    return [];
  }
}

function setStorageList(key, value) {
  try {
    if (typeof Util !== 'undefined' && typeof Util.setToStorage === 'function') {
      Util.setToStorage(key, value);
      return;
    }
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // ignore storage failures
  }
}

function showFeedback(type, message) {
  if (typeof Util === 'undefined') {
    return;
  }
  if (type === 'success' && typeof Util.showSuccess === 'function') {
    Util.showSuccess(message);
    return;
  }
  if (type === 'warning' && typeof Util.showWarning === 'function') {
    Util.showWarning(message);
    return;
  }
  if (type === 'info' && typeof Util.showInfo === 'function') {
    Util.showInfo(message);
  }
}

function setupFooterSubscribe() {
  const form = document.getElementById('footerSubscribeForm');
  const input = document.getElementById('footerEmail');
  const note = document.getElementById('footerNote');
  const storageKey = 'byose_market_newsletter_subscribers';

  if (!form || !input || !note) {
    return;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const email = input.value.trim().toLowerCase();
    if (!email || !input.checkValidity()) {
      note.textContent = 'Enter a valid email address.';
      note.classList.remove('is-success');
      return;
    }

    try {
      const current = new Set(JSON.parse(localStorage.getItem(storageKey) || '[]'));
      current.add(email);
      localStorage.setItem(storageKey, JSON.stringify(Array.from(current)));
      note.textContent = 'Thanks! You are subscribed.';
      note.classList.add('is-success');
      form.reset();
    } catch (_error) {
      note.textContent = 'Could not save your email. Please try again.';
      note.classList.remove('is-success');
    }
  });
}
