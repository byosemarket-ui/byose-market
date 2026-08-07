/**
 * Legacy loader — redirects old js/cart.js references to the unified Byose Cart bootstrap.
 * Prevents the obsolete Cart.init() implementation from competing with ByoseCart.
 */
(function loadByoseCart() {
  if (window.ByoseCart) {
    return;
  }

  const current = document.currentScript;
  const baseUrl = current && current.src
    ? current.src.slice(0, current.src.lastIndexOf('/') + 1)
    : '';

  const script = document.createElement('script');
  script.type = 'module';
  script.src = `${baseUrl}byose-cart-bootstrap.js`;
  document.head.appendChild(script);
})();
