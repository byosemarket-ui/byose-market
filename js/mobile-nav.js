// ===============================
// 📱 MOBILE BOTTOM NAV (FIXED PRO)
// ===============================
(function () {

  function getSitePrefix() {
    const path = window.location.pathname || "";
    if (path.includes("/account/settings/")) return "../../";
    if (path.includes("/account/") || path.includes("/logout/") || path.includes("/components/") || path.includes("/details/") || path.includes("/shop/") || path.includes("/auth/")) return "../";
    return "";
  }

  function sitePath(target) {
    return getSitePrefix() + String(target || "").replace(/^\/+/, "");
  }

  const NAV_HTML = `
    <nav class="mobile-bottom-nav" role="navigation" aria-label="Mobile navigation">
      
      <a href="${sitePath('index.html')}" class="mobile-bottom-nav__item" data-nav="home">
        <span class="mobile-bottom-nav__icon"><i class="fa-solid fa-house"></i></span>
        <span class="mobile-bottom-nav__label">Home</span>
      </a>

      <a href="${sitePath('shop.html')}" class="mobile-bottom-nav__item" data-nav="shop">
        <span class="mobile-bottom-nav__icon"><i class="fa-solid fa-store"></i></span>
        <span class="mobile-bottom-nav__label">Shop</span>
      </a>

      <a href="${sitePath('cart.html')}" class="mobile-bottom-nav__item" data-nav="cart">
        <span class="mobile-bottom-nav__icon"><i class="fas fa-shopping-cart"></i></span>
        <span class="mobile-bottom-nav__label">Cart</span>
        <span class="mobile-bottom-nav__badge" id="mobile-nav-cart-badge"></span>
      </a>

      <!-- 🔥 ACCOUNT (NO DIRECT LINK) -->
      <a href="#" class="mobile-bottom-nav__item nav-account" data-nav="account">
        <span class="mobile-bottom-nav__icon"><i class="fa-regular fa-user"></i></span>
        <span class="mobile-bottom-nav__label">Account</span>
      </a>

    </nav>
  `;

  // ===============================
  // 🧱 CREATE NAV
  // ===============================
  function createNav() {
    if (document.querySelector('.mobile-bottom-nav')) return;

    const div = document.createElement('div');
    div.innerHTML = NAV_HTML;
    document.body.appendChild(div.firstElementChild);

    updateActiveState();
    updateBadge();
    applyBodySpacing();
    bindNavPressState();
    bindAccountButton(); // 🔥 IMPORTANT
  }

  // ===============================
  // 👤 ACCOUNT BUTTON LOGIC
  // ===============================
  function bindAccountButton() {
    const acc = document.querySelector('.nav-account');

    if (!acc) return;

    acc.addEventListener('click', function (e) {
      e.preventDefault();

      // Use the canonical authentication service whenever it is available.
      if (window.authService && typeof window.authService.openAccount === 'function') {
        window.authService.openAccount();
        return;
      }

      // Compatibility handler for pages that load the legacy bridge.
      if (typeof window.handleAccountClick === 'function') {
        window.handleAccountClick();
        return;
      }

      // Do not trust the old bm_logged_in flag: it can survive an expired
      // session. Without the central service, fail closed to login.
      if (typeof window.isLoggedIn === 'function') {
        try {
          if (window.isLoggedIn()) { window.location.href = sitePath('account/account.html'); return; }
        } catch (e) { /* fallback below */ }
      }

      window.location.href = sitePath('login.html');
    });
  }

  // ===============================
  // 📏 BODY SPACING
  // ===============================
  function applyBodySpacing() {
    const nav = document.querySelector('.mobile-bottom-nav');
    if (!nav) return;

    function update() {
      const isDesktop = window.innerWidth >= 1025;

      if (isDesktop) {
        document.body.style.paddingBottom = '';
      } else {
        const h = nav.getBoundingClientRect().height || 66;
        document.body.style.paddingBottom = (h + 14) + 'px';
      }
    }

    update();
    window.addEventListener('resize', update);
  }

  // ===============================
  // 🎯 ACTIVE STATE
  // ===============================
  function updateActiveState() {
    const path = (location.pathname || "").toLowerCase();

    let active = null;

    if (path.includes("index")) active = "home";
    else if (path.includes("shop")) active = "shop";
    else if (path.includes("cart")) active = "cart";
    else if (path.includes("account") || path.includes("login")) active = "account";

    document.querySelectorAll('.mobile-bottom-nav__item').forEach(item => {
      item.classList.toggle(
        'mobile-bottom-nav__item--active',
        item.dataset.nav === active
      );
    });
  }

  function setActiveFromClick(item) {
    document.querySelectorAll('.mobile-bottom-nav__item').forEach(node => {
      node.classList.toggle('mobile-bottom-nav__item--active', node === item);
    });
  }

  function bindNavPressState() {
    document.querySelectorAll('.mobile-bottom-nav__item').forEach(item => {
      item.addEventListener('click', function () {
        setActiveFromClick(this);
      });

      item.addEventListener('pointerdown', function () {
        this.classList.add('is-pressing');
      });

      item.addEventListener('pointerup', function () {
        this.classList.remove('is-pressing');
      });

      item.addEventListener('pointerleave', function () {
        this.classList.remove('is-pressing');
      });
    });
  }

  // ===============================
  // 🛒 CART BADGE
  // ===============================
  function readCartCount() {
    if (window.ByoseCart && typeof window.ByoseCart.getCount === 'function') {
      return window.ByoseCart.getCount();
    }

    let count = 0;

    try {
      const cart = window.ByoseStorefrontSync?.readStateByKey?.('byose_market_cart_v1')
        || JSON.parse(localStorage.getItem('byose_market_cart_v1') || '[]');
      count = (Array.isArray(cart) ? cart : []).reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
    } catch (e) {}

    return count;
  }

  function updateBadge() {
    const el = document.getElementById('mobile-nav-cart-badge');
    if (!el) return;

    const count = readCartCount();

    if (count > 0) {
      el.style.display = "flex";
      el.textContent = count;
    } else {
      el.style.display = "none";
    }
  }

  function setupListeners() {
    document.addEventListener('cart:updated', updateBadge);
    document.addEventListener('byose:cart-updated', updateBadge);
    window.addEventListener('byose:storefront-state-updated', updateBadge);
    window.addEventListener('popstate', updateActiveState);
    window.addEventListener('pageshow', updateActiveState);
  }

  // ===============================
  // 🎨 FONT AWESOME
  // ===============================
  function ensureFontAwesome() {
    if (document.querySelector('link[href*="font-awesome"]')) return;

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css";
    document.head.appendChild(link);
  }

  // ===============================
  // 🚀 INIT
  // ===============================
  document.addEventListener("DOMContentLoaded", function () {
    ensureFontAwesome();
    createNav();
    setupListeners();
  });

})();