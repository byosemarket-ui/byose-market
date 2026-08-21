(function () {
  const STORAGE_KEYS = [
    'bm_current_user',
    'bm_user',
    'byose_market_user',
    'user'
  ];

  const FALLBACK_USER = {};

  const DEFAULT_PRODUCTS = [
    {
      label: 'Editor pick',
      name: 'Weekend Market Basket',
      description: 'A curated grocery combo for a fast, reliable weekly restock.',
      price: 'RWF 24,500',
      href: '/shop.html',
      tone: 'linear-gradient(135deg, rgba(0, 184, 148, 0.24), rgba(0, 184, 148, 0.05))'
    },
    {
      label: 'Popular',
      name: 'Fresh Home Essentials',
      description: 'Household picks customers keep reordering for convenience.',
      price: 'RWF 18,900',
      href: '/shop.html',
      tone: 'linear-gradient(135deg, rgba(255, 193, 7, 0.22), rgba(255, 193, 7, 0.06))'
    },
    {
      label: 'Trending',
      name: 'Smart Kitchen Bundle',
      description: 'Practical tools and modern accessories for everyday cooking.',
      price: 'RWF 31,200',
      href: '/shop.html',
      tone: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(59, 130, 246, 0.05))'
    },
    {
      label: 'New arrival',
      name: 'Premium Wellness Set',
      description: 'Quality care products selected for a more polished daily routine.',
      price: 'RWF 27,800',
      href: '/shop.html',
      tone: 'linear-gradient(135deg, rgba(236, 72, 153, 0.2), rgba(236, 72, 153, 0.05))'
    }
  ];

  const DEFAULT_NOTIFICATIONS = [
    {
      id: 'notif-order-shipped',
      message: 'Your order has been shipped',
      time: '2 min ago',
      status: 'unread'
    },
    {
      id: 'notif-discount',
      message: 'New discount available',
      time: '18 min ago',
      status: 'unread'
    },
    {
      id: 'notif-account-updated',
      message: 'Account updated successfully',
      time: '1 hr ago',
      status: 'read'
    }
  ];

  function safeParse(rawValue) {
    if (!rawValue) return null;

    try {
      return JSON.parse(rawValue);
    } catch {
      return null;
    }
  }

  function readStoredUser() {
    if (typeof window.getCurrentUser === 'function') {
      try {
        const currentUser = window.getCurrentUser();
        if (currentUser && typeof currentUser === 'object') {
          return currentUser;
        }
      } catch {
        // Ignore and continue to storage fallbacks.
      }
    }

    for (const key of STORAGE_KEYS) {
      const localValue = safeParse(localStorage.getItem(key));
      if (localValue && typeof localValue === 'object') {
        return localValue;
      }

      const sessionValue = safeParse(sessionStorage.getItem(key));
      if (sessionValue && typeof sessionValue === 'object') {
        return sessionValue;
      }
    }

    return null;
  }

  function splitName(fullName) {
    const parts = String(fullName || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    return {
      firstName: parts[0] || '',
      lastName: parts.slice(1).join(' ')
    };
  }

  function resolveAvatarUrl(avatar) {
    const raw = String(avatar || '').trim();
    if (!raw) return '';
    if (/^(?:https?:|data:|blob:)/i.test(raw)) return raw;
    if (raw.startsWith('/uploads/')) return raw;
    if (raw.startsWith('uploads/')) return `/${raw}`;
    if (/^(?:users|products|categories|reviews|hero|temp)\//i.test(raw)) return `/uploads/${raw}`;
    if (raw.startsWith('/')) return raw;
    return raw;
  }

  function normalizeUser(rawUser) {
    const sourceUser = rawUser && typeof rawUser === 'object' ? rawUser : FALLBACK_USER;
    const baseName = sourceUser.name || sourceUser.fullName || sourceUser.username || '';
    const split = splitName(baseName);
    const firstName = sourceUser.firstName || split.firstName || '';
    const lastName = sourceUser.lastName || split.lastName || '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || baseName || 'Guest User';
    const email = sourceUser.email || sourceUser.mail || '';
    const phone = sourceUser.phone || sourceUser.phoneNumber || sourceUser.tel || '';
    const contact = email || phone || 'No contact information';
    const userId = sourceUser.userId || sourceUser.id || sourceUser.uid || '—';
    const profileImage = resolveAvatarUrl(
      sourceUser.profileImage || sourceUser.avatar || sourceUser.image || sourceUser.photoURL || ''
    );

    return {
      firstName,
      lastName,
      fullName,
      email,
      phone,
      contact,
      userId,
      profileImage,
      initial: (firstName || fullName || 'U').trim().charAt(0).toUpperCase()
    };
  }

  function renderAvatar(user) {
    const avatarContainer = document.getElementById('userAvatar');
    if (!avatarContainer) return;

    avatarContainer.innerHTML = '';

    if (user.profileImage) {
      const image = document.createElement('img');
      image.src = user.profileImage;
      image.alt = user.fullName + ' profile photo';
      image.addEventListener('error', () => {
        avatarContainer.innerHTML = '';
        const initial = document.createElement('span');
        initial.className = 'avatar-initial';
        initial.textContent = user.initial;
        avatarContainer.appendChild(initial);
      });
      avatarContainer.appendChild(image);
      return;
    }

    const initial = document.createElement('span');
    initial.className = 'avatar-initial';
    initial.textContent = user.initial;
    avatarContainer.appendChild(initial);
  }

  function renderUser(user) {
    const nameElement = document.getElementById('userName');
    const contactElement = document.getElementById('userContact');
    const idElement = document.getElementById('userId');

    if (nameElement) {
      nameElement.textContent = user.fullName;
    }

    if (contactElement) {
      contactElement.textContent = user.contact;
    }

    if (idElement) {
      idElement.textContent = 'ID: ' + user.userId;
    }

    renderAvatar(user);
  }

  function createProductCard(product) {
    return [
      '<article class="product-card">',
      '  <div class="product-card__media" style="background: ' + product.tone + ';"></div>',
      '  <div>',
      '    <span class="product-card__eyebrow">' + product.label + '</span>',
      '    <h4>' + product.name + '</h4>',
      '    <p>' + product.description + '</p>',
      '  </div>',
      '  <div class="product-card__footer">',
      '    <span class="product-card__price">' + product.price + '</span>',
      '    <a class="product-card__link" href="' + product.href + '">View item</a>',
      '  </div>',
      '</article>'
    ].join('');
  }

  function renderProducts() {
    const productsRoot = document.getElementById('products');
    if (!productsRoot) return;

    productsRoot.innerHTML = DEFAULT_PRODUCTS.map(createProductCard).join('');
  }

  function createNotificationItem(notification) {
    const unreadClass = notification.status === 'unread' ? ' is-unread' : '';
    const statusLabel = notification.status === 'unread' ? 'Unread' : 'Read';

    return [
      '<button class="notification-item' + unreadClass + '" type="button" data-notification-id="' + notification.id + '">',
      '  <span class="notification-item-icon" aria-hidden="true"><i class="fa-solid fa-bell"></i></span>',
      '  <span class="notification-item-body">',
      '    <span class="notification-item-message">' + notification.message + '</span>',
      '    <span class="notification-item-meta">',
      '      <span>' + notification.time + '</span>',
      '      <span class="notification-item-status" aria-hidden="true"></span>',
      '      <span>' + statusLabel + '</span>',
      '    </span>',
      '  </span>',
      '</button>'
    ].join('');
  }

  function createEmptyNotificationState() {
    return [
      '<div class="notification-empty">',
      '  <div class="notification-empty-icon" aria-hidden="true"><i class="fa-regular fa-bell-slash"></i></div>',
      '  <h3>All caught up</h3>',
      '  <p>New account updates, shipping alerts, and discount news will appear here.</p>',
      '</div>'
    ].join('');
  }

  function initNotifications() {
    const notificationToggle = document.getElementById('notificationToggle');
    const notificationPanel = document.getElementById('notificationPanel');
    const notificationList = document.getElementById('notificationList');
    const notificationBadge = document.getElementById('notificationBadge');
    const markAllReadButton = document.getElementById('markAllNotificationsRead');

    if (!notificationToggle || !notificationPanel || !notificationList || !notificationBadge) {
      return;
    }

    const notifications = DEFAULT_NOTIFICATIONS.map(function (notification) {
      return Object.assign({}, notification);
    });

    function getUnreadCount() {
      return notifications.filter(function (notification) {
        return notification.status === 'unread';
      }).length;
    }

    function updateBadge() {
      const unreadCount = getUnreadCount();
      notificationBadge.textContent = String(unreadCount);
      notificationBadge.classList.toggle('is-empty', unreadCount === 0);
      notificationBadge.setAttribute('aria-label', unreadCount + ' notifications');
    }

    function renderNotifications() {
      if (!notifications.length) {
        notificationList.innerHTML = createEmptyNotificationState();
        return;
      }

      notificationList.innerHTML = notifications.map(createNotificationItem).join('');
    }

    function setPanelState(isOpen) {
      notificationPanel.hidden = !isOpen;
      notificationToggle.setAttribute('aria-expanded', String(isOpen));
      notificationToggle.classList.toggle('is-open', isOpen);
    }

    function markNotificationAsRead(notificationId) {
      const notification = notifications.find(function (item) {
        return item.id === notificationId;
      });

      if (!notification || notification.status === 'read') {
        return;
      }

      notification.status = 'read';
      renderNotifications();
      updateBadge();
    }

    notificationToggle.addEventListener('click', function (event) {
      event.stopPropagation();
      setPanelState(notificationPanel.hidden);
    });

    notificationPanel.addEventListener('click', function (event) {
      event.stopPropagation();

      const notificationButton = event.target.closest('[data-notification-id]');
      if (!notificationButton) {
        return;
      }

      markNotificationAsRead(notificationButton.getAttribute('data-notification-id'));
    });

    if (markAllReadButton) {
      markAllReadButton.addEventListener('click', function () {
        notifications.forEach(function (notification) {
          notification.status = 'read';
        });
        renderNotifications();
        updateBadge();
      });
    }

    document.addEventListener('click', function (event) {
      if (notificationPanel.hidden) {
        return;
      }

      if (!event.target.closest('.account-notification-wrap')) {
        setPanelState(false);
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        setPanelState(false);
      }
    });

    renderNotifications();
    updateBadge();
  }

  function initLogout() {
    const logoutButton = document.getElementById('logoutBtn');
    if (!logoutButton) return;

    logoutButton.addEventListener('click', function (event) {
      event.preventDefault();
      window.location.assign('../logout/logout.html');
    });
  }

  function initRevealAnimations() {
    const revealNodes = document.querySelectorAll('[data-reveal]');
    if (!revealNodes.length) return;

    if (typeof window.IntersectionObserver !== 'function') {
      revealNodes.forEach(function (node) {
        node.classList.add('is-visible');
      });
      return;
    }

    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;

        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, {
      threshold: 0.12,
      rootMargin: '0px 0px -40px 0px'
    });

    revealNodes.forEach(function (node) {
      observer.observe(node);
    });
  }

  function syncTheme() {
    const savedTheme = localStorage.getItem('bm_theme');
    if (!savedTheme) return;

    document.documentElement.setAttribute('data-theme', savedTheme);
  }

  function initAccountPage() {
    syncTheme();
    paintUser();
    initLogout();
    initRevealAnimations();
  }

  function paintUser() {
    const stored = readStoredUser();
    if (!stored && window.authService && typeof window.authService.hasStoredCredentials === 'function' && window.authService.hasStoredCredentials()) {
      return;
    }
    renderUser(normalizeUser(stored));
  }

  window.addEventListener('userUpdated', paintUser);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAccountPage);
  } else {
    initAccountPage();
  }
})();