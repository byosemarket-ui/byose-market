(function () {
  'use strict';

  const favoritesRoot = document.getElementById('favoriteStores');
  const discoverRoot = document.getElementById('discoverStores');
  const statusHost = document.getElementById('storesStatusHost');
  const countChip = document.getElementById('storesCountChip');
  const countLabel = document.getElementById('storesCountLabel');
  const toast = document.getElementById('storesToast');
  let toastTimer = null;
  let loading = false;
  let currentFavorites = { items: [], count: 0 };

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(message, type) {
    if (!toast || !message) return;
    toast.textContent = message;
    toast.classList.remove('is-error', 'is-success', 'is-visible');
    if (type === 'error') toast.classList.add('is-error');
    if (type === 'success') toast.classList.add('is-success');
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }

  function storeVisitHref(store) {
    const slug = encodeURIComponent(String(store?.slug || store?.publicId || store?.id || ''));
    return `../../store.html?slug=${slug}`;
  }

  function storeLogo(store) {
    const logo = String(store?.logo || '').trim();
    if (!logo) return '../../img/logo.png';
    if (logo.startsWith('http') || logo.startsWith('/')) return logo;
    return `../../${logo.replace(/^\.\.\//, '').replace(/^\.\//, '')}`;
  }

  function setCount(count) {
    const total = Number(count || 0);
    if (countChip) countChip.hidden = total <= 0;
    if (countLabel) countLabel.textContent = `${total} store${total === 1 ? '' : 's'}`;
    try {
      window.dispatchEvent(new CustomEvent('byose:favorite-stores-updated', {
        detail: { count: total, favorites: currentFavorites }
      }));
    } catch (_error) {}
  }

  function renderLoading() {
    statusHost.replaceChildren();
    favoritesRoot.className = 'stores-skeleton';
    favoritesRoot.replaceChildren();
    for (let i = 0; i < 3; i += 1) {
      const card = document.createElement('div');
      card.className = 'stores-skeleton__card';
      favoritesRoot.append(card);
    }
    discoverRoot.replaceChildren();
  }

  function renderError(message) {
    favoritesRoot.className = '';
    favoritesRoot.replaceChildren();
    discoverRoot.replaceChildren();
    statusHost.replaceChildren();

    const box = document.createElement('div');
    box.className = 'stores-error';
    box.innerHTML = `
      <div class="stores-error__icon" aria-hidden="true"><i class="fa-solid fa-triangle-exclamation"></i></div>
      <h2>Unable to load stores</h2>
      <p>${escapeHtml(message || 'We could not load your favorite stores right now.')}</p>
    `;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'af-button is-primary';
    retry.textContent = 'Try again';
    retry.addEventListener('click', () => load());
    box.append(retry);
    statusHost.append(box);
    setCount(currentFavorites.count || 0);
  }

  function renderEmptyFavorites() {
    const empty = document.createElement('div');
    empty.className = 'stores-empty';
    empty.innerHTML = `
      <div class="stores-empty__icon" aria-hidden="true"><i class="fa-solid fa-store"></i></div>
      <h2>No Favorite Stores Yet</h2>
      <p>Follow stores you love and find them here.</p>
      <a class="af-button is-primary" href="#discover">Explore Stores</a>
    `;
    favoritesRoot.append(empty);
  }

  function renderStars(rating) {
    const value = Number(rating || 0);
    if (!Number.isFinite(value) || value <= 0) return '';
    return `<span class="store-card__rating" aria-label="Rated ${value.toFixed(1)} out of 5"><i class="fa-solid fa-star" aria-hidden="true"></i> ${value.toFixed(1)}</span>`;
  }

  function createStoreCard(store, { following = false, mode = 'favorite' } = {}) {
    const article = document.createElement('article');
    article.className = 'store-card';
    const statusLabel = String(store.status || 'active').toLowerCase() === 'active' ? 'Open' : 'Unavailable';
    const productCount = Number(store.productCount || 0);
    const followerCount = Number(store.followerCount || 0);
    const prefs = store.notificationPrefs && typeof store.notificationPrefs === 'object'
      ? store.notificationPrefs
      : null;
    const notifyNewProducts = prefs ? Boolean(prefs.notifyNewProducts) : true;
    const notifyOffers = prefs ? Boolean(prefs.notifyOffers) : true;
    const notifyAnnouncements = prefs ? Boolean(prefs.notifyAnnouncements) : true;

    article.innerHTML = `
      <div class="store-card__top">
        <img class="store-card__logo" src="${escapeHtml(storeLogo(store))}" alt="${escapeHtml(store.name || 'Store')}" loading="lazy">
        <div class="store-card__identity">
          <h2>${escapeHtml(store.name || 'Store')}</h2>
          <p class="store-card__category">${escapeHtml(store.category || 'Marketplace')}</p>
        </div>
      </div>
      <div class="store-card__meta">
        ${renderStars(store.rating)}
        <span class="store-card__pill">${productCount} product${productCount === 1 ? '' : 's'}</span>
        <span class="store-card__pill ${statusLabel === 'Open' ? 'is-active' : ''}">${escapeHtml(statusLabel)}</span>
        ${following ? '<span class="store-card__pill is-following">Following</span>' : ''}
        ${followerCount > 0 ? `<span class="store-card__pill">${followerCount} follower${followerCount === 1 ? '' : 's'}</span>` : ''}
      </div>
      <p class="store-card__description">${escapeHtml(store.description || store.location || 'Trusted BYOSE Market seller.')}</p>
      <div class="store-card__actions"></div>
      ${following && mode === 'favorite' ? `
        <div class="store-card__notify" data-store-id="${escapeHtml(String(store.publicId || store.id || store.slug || ''))}">
          <p class="store-card__notify-title">Store alerts</p>
          <label class="store-card__notify-row"><input type="checkbox" data-pref="notifyNewProducts" ${notifyNewProducts ? 'checked' : ''}> New products</label>
          <label class="store-card__notify-row"><input type="checkbox" data-pref="notifyOffers" ${notifyOffers ? 'checked' : ''}> Offers</label>
          <label class="store-card__notify-row"><input type="checkbox" data-pref="notifyAnnouncements" ${notifyAnnouncements ? 'checked' : ''}> Announcements</label>
        </div>
      ` : ''}
    `;

    const actions = article.querySelector('.store-card__actions');
    const visit = document.createElement('a');
    visit.className = 'af-button is-primary';
    visit.href = storeVisitHref(store);
    visit.textContent = 'Visit Store';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = following ? 'af-button is-danger' : 'af-button';
    toggle.textContent = following ? 'Unfollow' : 'Follow';

    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      try {
        if (following) {
          const favorites = await window.favoriteStoresService.unfollow(store.publicId || store.id || store.slug);
          showToast('Store unfollowed.', 'success');
          await renderAll(favorites);
        } else {
          const favorites = await window.favoriteStoresService.follow(store.publicId || store.id || store.slug);
          showToast('You are now following this store.', 'success');
          await renderAll(favorites);
        }
      } catch (error) {
        showToast(
          window.ByoseFavoriteStores?.friendlyError
            ? window.ByoseFavoriteStores.friendlyError(error)
            : 'Unable to update favorite stores.',
          'error'
        );
        toggle.disabled = false;
      }
    });

    actions.append(visit, toggle);

    const notifyHost = article.querySelector('.store-card__notify');
    notifyHost?.querySelectorAll('input[data-pref]').forEach((input) => {
      input.addEventListener('change', async () => {
        const prefs = {
          notifyNewProducts: Boolean(notifyHost.querySelector('[data-pref="notifyNewProducts"]')?.checked),
          notifyOffers: Boolean(notifyHost.querySelector('[data-pref="notifyOffers"]')?.checked),
          notifyAnnouncements: Boolean(notifyHost.querySelector('[data-pref="notifyAnnouncements"]')?.checked)
        };
        try {
          await window.favoriteStoresService.updateNotificationPrefs(store.publicId || store.id || store.slug, prefs);
          showToast('Store alert preferences saved.', 'success');
        } catch (_error) {
          showToast('Unable to save alert preferences.', 'error');
        }
      });
    });

    return article;
  }

  async function renderAll(favoritesPayload, discoverList) {
    currentFavorites = favoritesPayload || { items: [], count: 0 };
    const items = Array.isArray(currentFavorites.items) ? currentFavorites.items : [];
    const favoriteIds = new Set(items.map((entry) => String(entry.store?.id || entry.store?.publicId || '')));

    favoritesRoot.className = 'stores-grid';
    favoritesRoot.replaceChildren();
    statusHost.replaceChildren();
    setCount(currentFavorites.count || items.length);

    if (!items.length) {
      renderEmptyFavorites();
    } else {
      items.forEach((entry) => {
        if (!entry.store) return;
        favoritesRoot.append(createStoreCard({
          ...entry.store,
          notificationPrefs: entry.notificationPrefs || entry.store.notificationPrefs
        }, { following: true, mode: 'favorite' }));
      });
    }

    let stores = discoverList;
    if (!stores) {
      stores = await window.favoriteStoresService.discover();
    }

    discoverRoot.className = 'stores-grid';
    discoverRoot.replaceChildren();
    const list = Array.isArray(stores) ? stores : [];
    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'af-empty';
      empty.textContent = 'No stores are available to follow yet.';
      discoverRoot.append(empty);
      return;
    }

    list.forEach((store) => {
      const following = Boolean(store.isFavorite) || favoriteIds.has(String(store.id)) || favoriteIds.has(String(store.publicId));
      discoverRoot.append(createStoreCard(store, { following, mode: 'discover' }));
    });
  }

  async function load() {
    if (loading) return;
    loading = true;
    renderLoading();

    try {
      const [favorites, stores] = await Promise.all([
        window.favoriteStoresService.getFavorites(),
        window.favoriteStoresService.discover()
      ]);
      await renderAll(favorites, stores);
    } catch (error) {
      const message = error?.status === 401
        ? 'Please sign in to manage favorite stores.'
        : 'We could not load your favorite stores right now.';
      renderError(message);
    } finally {
      loading = false;
    }
  }

  load();
})();
