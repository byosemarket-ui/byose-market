(function () {
  'use strict';

  const hero = document.getElementById('storeHero');
  const grid = document.getElementById('storeProductGrid');
  let currentStore = null;
  let following = false;

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getSlug() {
    const params = new URLSearchParams(window.location.search);
    return String(params.get('slug') || params.get('id') || 'byose-market').trim();
  }

  function storeLogo(store) {
    const logo = String(store?.logo || '').trim();
    if (!logo) return 'img/logo.png';
    if (logo.startsWith('http') || logo.startsWith('/')) return logo;
    return logo.replace(/^\.\.\//, '').replace(/^\.\//, '');
  }

  function renderError(message) {
    hero.innerHTML = `
      <div class="store-hero__error">
        <p>${escapeHtml(message || 'Unable to load this store.')}</p>
        <p><a href="shop.html">Continue shopping</a> · <button type="button" id="storeRetry">Try again</button></p>
      </div>
    `;
    document.getElementById('storeRetry')?.addEventListener('click', loadStore);
    grid.innerHTML = '';
  }

  function updateFollowButton() {
    const button = document.getElementById('storeFollowBtn');
    if (!button) return;
    window.ByoseFavoriteStores?.updateFollowButton(button, following);
  }

  function renderHero(store) {
    const statusLabel = String(store.status || 'active').toLowerCase() === 'active' ? 'Open' : 'Unavailable';
    const rating = Number(store.rating || 0);
    const productCount = Number(store.productCount || 0);
    const followerCount = Number(store.followerCount || 0);

    hero.innerHTML = `
      <div class="store-hero__card">
        <img class="store-hero__logo" src="${escapeHtml(storeLogo(store))}" alt="${escapeHtml(store.name || 'Store')}">
        <div class="store-hero__copy">
          <h1>${escapeHtml(store.name || 'Store')}</h1>
          <p>${escapeHtml(store.description || 'Trusted BYOSE Market seller.')}</p>
          <div class="store-hero__meta">
            <span class="store-pill">${escapeHtml(store.category || 'Marketplace')}</span>
            ${rating > 0 ? `<span class="store-pill"><i class="fa-solid fa-star" aria-hidden="true"></i> ${rating.toFixed(1)}</span>` : ''}
            <span class="store-pill">${productCount} product${productCount === 1 ? '' : 's'}</span>
            <span class="store-pill ${statusLabel === 'Open' ? 'is-active' : ''}">${escapeHtml(statusLabel)}</span>
            ${store.location ? `<span class="store-pill"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${escapeHtml(store.location)}</span>` : ''}
            ${followerCount > 0 ? `<span class="store-pill">${followerCount} follower${followerCount === 1 ? '' : 's'}</span>` : ''}
          </div>
        </div>
        <div class="store-hero__actions">
          <button type="button" class="store-follow-btn" id="storeFollowBtn" aria-pressed="false">Follow</button>
          <a class="store-account-link" href="account/pages/stores.html">My Stores</a>
        </div>
      </div>
    `;

    following = Boolean(store.isFavorite);
    updateFollowButton();

    document.getElementById('storeFollowBtn')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      const wasFollowing = following;
      following = !wasFollowing;
      updateFollowButton();

      try {
        const result = await window.ByoseFavoriteStores.toggle(
          store.publicId || store.slug || store.id,
          wasFollowing
        );
        if (result?.redirected) {
          following = wasFollowing;
          updateFollowButton();
          return;
        }
        following = Boolean(result?.active);
        updateFollowButton();
      } catch (error) {
        following = wasFollowing;
        updateFollowButton();
        window.ByoseFavoriteStores?.showToast(
          window.ByoseFavoriteStores.friendlyError(error),
          'error'
        );
      } finally {
        button.disabled = false;
      }
    });
  }

  async function renderProducts(products) {
    const ProductCardSystem = await import('./js/product-card-system.js').then((module) => module.default);
    if (!Array.isArray(products) || !products.length) {
      grid.innerHTML = '<div class="store-products-empty">No products in this store right now.</div>';
      return;
    }

    grid.innerHTML = ProductCardSystem.renderCards(products, { eagerCount: 4 });
    ProductCardSystem.bindCards(grid);
  }

  async function loadStore() {
    hero.innerHTML = '<div class="store-hero__loading" id="storeLoading">Loading store…</div>';
    grid.innerHTML = '';

    try {
      if (!window.ByoseFavoriteStores?.getStore) {
        throw new Error('Store service unavailable');
      }

      const payload = await window.ByoseFavoriteStores.getStore(getSlug());
      currentStore = payload.store;
      if (!currentStore) {
        renderError('Store not found.');
        return;
      }

      document.title = `${currentStore.name || 'Store'} | Byose Market`;
      renderHero(currentStore);
      await renderProducts(payload.products || []);
    } catch (error) {
      renderError(
        error?.status === 404
          ? 'Store not found.'
          : 'We could not load this store right now.'
      );
    }
  }

  document.addEventListener('DOMContentLoaded', loadStore);
})();
