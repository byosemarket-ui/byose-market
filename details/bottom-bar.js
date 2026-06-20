(function () {
  const CART_KEY = 'byose_market_cart_v1';
  const WHATSAPP_NUMBER = '250723137250';

  function getBottomBar() {
    return document.getElementById('detailsBottomBar');
  }

  function removeLegacyMobileNav() {
    const removeNav = () => {
      document.querySelectorAll('.mobile-bottom-nav').forEach(nav => nav.remove());
    };

    removeNav();

    if (!document.body) {
      return;
    }

    const observer = new MutationObserver(removeNav);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function getCartCount() {
    if (window.ByoseCart && typeof window.ByoseCart.getCount === 'function') {
      return window.ByoseCart.getCount();
    }

    try {
      const cart = window.ByoseStorefrontSync?.readStateByKey?.(CART_KEY)
        || JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      return (Array.isArray(cart) ? cart : []).reduce((count, item) => count + (Number(item.qty) || 0), 0);
    } catch (error) {
      return 0;
    }
  }

  function updateCartBadge() {
    const badge = document.getElementById('detailsCartBadge');
    if (!badge) {
      return;
    }

    const count = getCartCount();
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  }

  function updateBodySpacing() {
    const bar = getBottomBar();
    if (!bar) {
      return;
    }

    if (window.innerWidth >= 1025) {
      document.body.style.paddingBottom = '';
      document.body.style.removeProperty('--details-bottom-bar-offset');
      return;
    }

    const height = Math.ceil(bar.getBoundingClientRect().height || 90);
    const offset = height + 14;
    document.body.style.paddingBottom = `${offset}px`;
    document.body.style.setProperty('--details-bottom-bar-offset', `${offset}px`);
  }

  function forwardActionClick(buttonId) {
    return () => {
      const button = document.getElementById(buttonId);
      button?.click();
    };
  }

  function openProductChat() {
    const productName = document.getElementById('productName')?.textContent?.trim() || 'this product';
    const productPrice = document.getElementById('productPrice')?.textContent?.trim() || '';
    const message = [
      `Hello, I need help with ${productName}.`,
      productPrice ? `Price shown: ${productPrice}.` : '',
      'Please share availability and delivery details.',
      window.location.href
    ].filter(Boolean).join('\n');

    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
  }

  function bindActions() {
    document.getElementById('stickyAddToCartBtn')?.addEventListener('click', forwardActionClick('addToCartBtn'));
    document.getElementById('stickyBuyNowBtn')?.addEventListener('click', forwardActionClick('buyNowBtn'));
    document.getElementById('detailsChatButton')?.addEventListener('click', openProductChat);
  }

  function init() {
    if (!document.body.classList.contains('details-page')) {
      return;
    }

    removeLegacyMobileNav();
    bindActions();
    updateCartBadge();
    updateBodySpacing();

    document.addEventListener('cart:updated', updateCartBadge);
    document.addEventListener('byose:cart-updated', updateCartBadge);
    window.addEventListener('kcart:updated', updateCartBadge);
    window.addEventListener('byose:storefront-state-updated', updateCartBadge);
    window.addEventListener('resize', updateBodySpacing, { passive: true });
    window.addEventListener('pageshow', () => {
      updateCartBadge();
      updateBodySpacing();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();